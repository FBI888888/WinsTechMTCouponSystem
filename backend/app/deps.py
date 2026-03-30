from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.models.api_key import APIKey
import logging

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)

# 用户信息缓存（简单内存缓存，生产环境建议使用 Redis）
_user_cache = {}
_user_cache_time = {}
CACHE_TTL_SECONDS = 300  # 缓存5分钟


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})

    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def verify_token(token: str) -> Optional[dict]:
    """验证 JWT Token"""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError as e:
        logger.debug(f"JWT decode error: {e}")
        return None


def _get_cached_user(user_id: int) -> Optional[User]:
    """从缓存获取用户信息"""
    now = datetime.now()
    if user_id in _user_cache:
        cache_time = _user_cache_time.get(user_id)
        if cache_time and (now - cache_time).total_seconds() < CACHE_TTL_SECONDS:
            return _user_cache[user_id]
    return None


def _cache_user(user: User):
    """缓存用户信息"""
    _user_cache[user.id] = user
    _user_cache_time[user.id] = datetime.now()


def invalidate_user_cache(user_id: int):
    """使用户缓存失效（用户信息更新时调用）"""
    _user_cache.pop(user_id, None)
    _user_cache_time.pop(user_id, None)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """获取当前用户（带缓存）"""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    token = credentials.credentials
    payload = verify_token(token)

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )

    # Convert to int since we store as string in JWT
    try:
        user_id = int(user_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user ID in token",
        )

    # 先尝试从缓存获取
    cached_user = _get_cached_user(user_id)
    if cached_user:
        if not cached_user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User is inactive",
            )
        return cached_user

    # 缓存未命中，查询数据库
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is inactive",
        )

    # 缓存用户信息
    _cache_user(user)

    return user


async def get_current_admin_user(
    current_user: User = Depends(get_current_user)
) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    return current_user


async def verify_api_key(
    api_key: str,
    api_secret: str,
    db: Session = Depends(get_db)
) -> Optional[APIKey]:
    """Verify API key and secret"""
    key_obj = db.query(APIKey).filter(
        APIKey.key == api_key,
        APIKey.is_active == True
    ).first()

    if not key_obj:
        return None

    if key_obj.expired_at and key_obj.expired_at < datetime.now():
        return None

    if key_obj.secret != api_secret:
        return None

    # Update last used time
    key_obj.last_used_at = datetime.now()
    db.commit()

    return key_obj
