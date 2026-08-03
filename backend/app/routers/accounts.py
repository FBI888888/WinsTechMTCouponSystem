from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from sqlalchemy.orm.attributes import flag_modified
import httpx
from app.database import get_db
from app.models.user import User
from app.models.account import MTAccount, AccountStatus
from app.models.gift_claim import GiftClaim
from app.models.log import OperationLog
from app.schemas.account import (
    AccountCreate, AccountUpdate, AccountResponse,
    AccountCaptureRequest, AccountCheckRequest, AccountCheckResponse,
    AccountCooldownRequest, AccountClearCooldownRequest, GiftType,
)
from app.deps import get_current_user
from app.utils.encryption import encrypt_token, decrypt_token

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


def _normalize_platform(value: Optional[str], fallback: str = "android") -> str:
    key = str(value or "").strip().lower()
    if key in {"android", "windows", "ios", "harmony"}:
        return key
    return fallback


def _parse_account_status(value: Optional[str]) -> AccountStatus:
    if value == AccountStatus.NORMAL.value:
        return AccountStatus.NORMAL
    if value == AccountStatus.INVALID.value:
        return AccountStatus.INVALID
    return AccountStatus.UNCHECKED


def _encrypt_account_token(token: str) -> str:
    """加密账号Token"""
    return encrypt_token(token)


def _decrypt_account_token(encrypted_token: str) -> str:
    """解密账号Token"""
    return decrypt_token(encrypted_token)


def _normalize_gift_type(value: Optional[str]) -> str:
    key = str(value or "meituan").strip().lower()
    if key not in ("meituan", "live"):
        raise HTTPException(status_code=400, detail="gift_type 必须是 meituan 或 live")
    return key


def _cooldown_column(gift_type: str):
    return (
        MTAccount.cooldown_until_meituan
        if gift_type == "meituan"
        else MTAccount.cooldown_until_live
    )


def _last_claim_column(gift_type: str):
    return (
        MTAccount.last_claim_at_meituan
        if gift_type == "meituan"
        else MTAccount.last_claim_at_live
    )


def _set_account_cooldown(account: MTAccount, gift_type: str, until: datetime, limit_at: datetime):
    if gift_type == "live":
        account.cooldown_until_live = until
        account.last_limit_at_live = limit_at
    else:
        account.cooldown_until_meituan = until
        account.last_limit_at_meituan = limit_at
        # 兼容旧字段：与美团冷却保持同步
        account.cooldown_until = until
        account.last_limit_at = limit_at


def _clear_account_cooldown(account: MTAccount, gift_type: Optional[str]):
    if gift_type is None or gift_type == "meituan":
        account.cooldown_until_meituan = None
        account.cooldown_until = None
    if gift_type is None or gift_type == "live":
        account.cooldown_until_live = None


def _attach_today_claim_counts(db: Session, accounts: list) -> None:
    account_ids = [account.id for account in accounts]
    for account in accounts:
        account.today_meituan_claim_count = 0
        account.today_live_claim_count = 0
    if not account_ids:
        return

    today_start = datetime.combine(datetime.now().date(), datetime.min.time())
    tomorrow_start = today_start + timedelta(days=1)
    rows = (
        db.query(
            GiftClaim.account_id,
            GiftClaim.gift_type,
            func.count(GiftClaim.id),
        )
        .filter(
            GiftClaim.account_id.in_(account_ids),
            GiftClaim.claimed_at >= today_start,
            GiftClaim.claimed_at < tomorrow_start,
        )
        .group_by(GiftClaim.account_id, GiftClaim.gift_type)
        .all()
    )
    counts = {
        (int(account_id), str(gift_type or "meituan")): int(count or 0)
        for account_id, gift_type, count in rows
    }
    for account in accounts:
        account.today_meituan_claim_count = counts.get((account.id, "meituan"), 0)
        account.today_live_claim_count = counts.get((account.id, "live"), 0)


@router.get("", response_model=List[AccountResponse])
def get_accounts(
    skip: int = 0,
    limit: int = 100,
    user_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(MTAccount)
    if user_id:
        query = query.filter(MTAccount.user_id == user_id)
    if status_filter:
        query = query.filter(MTAccount.status == status_filter)

    accounts = query.offset(skip).limit(limit).all()
    _attach_today_claim_counts(db, accounts)

    # 解密 Token 后返回
    for account in accounts:
        account.token = _decrypt_account_token(account.token)

    return accounts


@router.post("", response_model=AccountResponse)
def create_account(
    account: AccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Check if userid already exists
    existing = db.query(MTAccount).filter(MTAccount.userid == account.userid).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account with this userid already exists"
        )

    # 加密 Token 后存储
    encrypted_token = _encrypt_account_token(account.token)

    db_account = MTAccount(
        remark=account.remark,
        userid=account.userid,
        token=encrypted_token,
        url=account.url,
        csecuuid=account.csecuuid,
        open_id=account.open_id,
        open_id_cipher=account.open_id_cipher,
        platform=_normalize_platform(account.platform, "android"),
        user_id=account.user_id or current_user.id if current_user.role == "admin" else current_user.id,
        status=AccountStatus.UNCHECKED
    )
    db.add(db_account)
    db.commit()
    db.refresh(db_account)

    # Log operation
    log = OperationLog(
        user_id=current_user.id,
        action="create_account",
        target_type="account",
        target_id=db_account.id,
        details=f"Created account: {account.remark or account.userid}"
    )
    db.add(log)
    db.commit()

    # 返回时解密 Token
    db_account.token = _decrypt_account_token(db_account.token)
    return db_account


@router.post("/capture", response_model=AccountResponse)
def capture_account(
    request: AccountCaptureRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Check if userid already exists
    existing = db.query(MTAccount).filter(MTAccount.userid == request.userid).first()
    if existing:
        # Update existing account
        existing.remark = request.remark
        existing.token = _encrypt_account_token(request.token)  # 加密存储
        existing.url = request.url
        existing.csecuuid = request.csecuuid or existing.csecuuid
        existing.open_id = request.open_id or existing.open_id
        existing.open_id_cipher = request.open_id_cipher or existing.open_id_cipher
        # 平台字段：显式传入时始终更新并标记脏数据，确保写入数据库
        if request.platform is not None and str(request.platform).strip():
            existing.platform = _normalize_platform(request.platform, existing.platform or "android")
            flag_modified(existing, "platform")
        if request.status:
            existing.status = _parse_account_status(request.status)
            existing.last_check_time = datetime.now()
        db.add(existing)
        db.commit()
        db.refresh(existing)
        # 返回时解密
        existing.token = _decrypt_account_token(existing.token)
        return existing

    # Create new account
    platform_value = _normalize_platform(request.platform, "android")
    db_account = MTAccount(
        remark=request.remark,
        userid=request.userid,
        token=_encrypt_account_token(request.token),  # 加密存储
        url=request.url,
        csecuuid=request.csecuuid,
        open_id=request.open_id,
        open_id_cipher=request.open_id_cipher,
        platform=platform_value,
        status=_parse_account_status(request.status) if request.status else AccountStatus.UNCHECKED
    )
    if request.status:
        db_account.last_check_time = datetime.now()
    db.add(db_account)
    db.commit()
    db.refresh(db_account)

    # Log operation
    log = OperationLog(
        user_id=current_user.id,
        action="capture_account",
        target_type="account",
        target_id=db_account.id,
        details=f"Captured account: {request.remark or request.userid}"
    )
    db.add(log)
    db.commit()

    # 返回时解密
    db_account.token = _decrypt_account_token(db_account.token)
    return db_account


@router.get("/available-for-gift", response_model=List[AccountResponse])
def get_available_accounts_for_gift(
    limit: int = Query(100, ge=1, le=500),
    gift_type: GiftType = Query("meituan"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """返回可用于指定类型礼物领取的账号：启用、非失效、对应类型冷却已过期或未冷却。"""
    gift_type = _normalize_gift_type(gift_type)
    now = datetime.now()
    cooldown_col = _cooldown_column(gift_type)
    claim_col = _last_claim_column(gift_type)
    accounts = (
        db.query(MTAccount)
        .filter(
            MTAccount.disabled == 0,
            MTAccount.status != AccountStatus.INVALID,
            or_(
                cooldown_col.is_(None),
                cooldown_col <= now,
            ),
        )
        .order_by(claim_col.is_(None).desc(), claim_col.asc(), MTAccount.id.asc())
        .limit(limit)
        .all()
    )
    for account in accounts:
        account.token = _decrypt_account_token(account.token)
    return accounts


@router.get("/random-gift-id")
def get_random_gift_id(
    account_id: int = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取礼物号（用于风控检测）
    如果指定account_id，则获取该账号的礼物号
    否则获取任意一个礼物号
    礼物订单特征：is_gift=True 或 order_view_id 长度大于20
    """
    from app.models.order import Order
    from sqlalchemy import func

    query = db.query(Order).filter(
        Order.order_view_id.isnot(None),
        Order.order_view_id != '',
        (Order.is_gift == True) | (func.length(Order.order_view_id) > 20)
    )

    # 如果指定了account_id，筛选该账号的订单
    if account_id:
        query = query.filter(Order.account_id == account_id)

    order = query.first()

    if order and order.order_view_id:
        return {"gift_id": order.order_view_id}
    return {"gift_id": None}


@router.get("/{account_id}", response_model=AccountResponse)
def get_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # 解密 Token 后返回
    account.token = _decrypt_account_token(account.token)
    return account


@router.put("/{account_id}", response_model=AccountResponse)
def update_account(
    account_id: int,
    account: AccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    db_account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    update_data = account.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        # 如果是 token 字段，需要加密
        if field == "token" and value:
            value = _encrypt_account_token(value)
        if field == "platform":
            value = _normalize_platform(value, db_account.platform or "android")
        if field == "status":
            value = _parse_account_status(value)
            db_account.last_check_time = datetime.now()
        setattr(db_account, field, value)
        if field == "platform":
            flag_modified(db_account, "platform")

    db.add(db_account)
    db.commit()
    db.refresh(db_account)

    # Log operation
    log = OperationLog(
        user_id=current_user.id,
        action="update_account",
        target_type="account",
        target_id=db_account.id,
        details=f"Updated account: {db_account.remark or db_account.userid}"
    )
    db.add(log)
    db.commit()

    # 返回时解密 Token
    db_account.token = _decrypt_account_token(db_account.token)
    return db_account


@router.delete("/{account_id}")
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Log before delete
    log = OperationLog(
        user_id=current_user.id,
        action="delete_account",
        target_type="account",
        target_id=account_id,
        details=f"Deleted account: {account.remark or account.userid}"
    )
    db.add(log)

    db.delete(account)
    db.commit()

    return {"message": "Account deleted successfully"}


@router.post("/check", response_model=List[AccountCheckResponse])
async def check_accounts_status(
    check_request: List[AccountCheckRequest],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 批量查询所有账号（避免N+1）
    userids = [req.userid for req in check_request]
    accounts = db.query(MTAccount).filter(MTAccount.userid.in_(userids)).all()
    account_map = {a.userid: a for a in accounts}

    results = []
    for req in check_request:
        result = await check_account_status(req)
        results.append(result)

        # 更新账号状态
        account = account_map.get(req.userid)
        if account:
            account.status = AccountStatus.NORMAL if result.code == 0 else AccountStatus.INVALID
            account.last_check_time = datetime.now()

    # 一次提交所有更新
    db.commit()

    return results


async def check_account_status(request: AccountCheckRequest) -> AccountCheckResponse:
    """Check if account token is valid"""
    url = f"https://ordercenter.meituan.com/ordercenter/user/orders?userid={request.userid}&token={request.token}&offset=0&limit=10&platformid=6&statusFilter=0&version=0&yodaReady=wx&csecappid=wxde8ac0a21135c07d&csecplatform=3&csecversionname=9.25.105&csecversion=1.4.0"

    headers = {
        "Host": "ordercenter.meituan.com",
        "Connection": "keep-alive",
        "User-Agent": "",
        "xweb_xhr": "1",
        "utm_medium": "",
        "clientversion": "3.8.9",
        "Accept": "*/*",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "Referer": "https://servicewechat.com/wxde8ac0a21135c07d/1451/page-frame.html",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Content-Type": "application/json"
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, timeout=10.0)
            code = response.json().get("code") if response.status_code == 200 else -1
            return AccountCheckResponse(
                success=True,
                code=code if code == 0 else (code if code else -1)
            )
    except Exception as e:
        return AccountCheckResponse(
            success=False,
            code=-1,
            message=str(e)
        )


@router.post("/{account_id}/scan")
async def scan_single_account(
    account_id: int,
    status_filter: int = 2,  # 默认待使用
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    扫描单个账号的订单和券码
    status_filter: 0=全部, 2=待使用, 3=已完成, 4=退款/售后
    """
    account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")

    if account.status == AccountStatus.INVALID:
        raise HTTPException(status_code=400, detail="账号已失效，请先更新Token")

    # 执行扫描（手动扫描不检查间隔）
    from app.services.meituan.scanner import ScheduledTaskService

    task_service = ScheduledTaskService()
    db.refresh(account)  # 确保获取最新数据

    try:
        result = await task_service.run_scan_for_account(db, account, status_filter)
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/{account_id}/toggle-disabled")
async def toggle_account_disabled(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    切换账号的禁用状态
    """
    account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")

    # 切换禁用状态
    account.disabled = 1 if account.disabled == 0 else 0
    db.commit()
    db.refresh(account)

    # Log operation
    log = OperationLog(
        user_id=current_user.id,
        action="toggle_account_disabled",
        target_type="account",
        target_id=account.id,
        details=f"{'禁用' if account.disabled == 1 else '启用'}账号: {account.remark or account.userid}"
    )
    db.add(log)
    db.commit()

    # 返回时解密 Token
    account.token = _decrypt_account_token(account.token)
    return account


@router.post("/{account_id}/mark-cooldown", response_model=AccountResponse)
def mark_account_cooldown(
    account_id: int,
    request: AccountCooldownRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """标记账号进入指定类型礼物领取冷却（通常因 result=1011）。"""
    account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")

    gift_type = _normalize_gift_type(request.gift_type)
    hours = request.hours if request.hours and request.hours > 0 else 12
    now = datetime.now()
    _set_account_cooldown(account, gift_type, now + timedelta(hours=hours), now)
    db.commit()
    db.refresh(account)

    log = OperationLog(
        user_id=current_user.id,
        action="mark_account_cooldown",
        target_type="account",
        target_id=account.id,
        details=(
            f"冷却{hours}小时 gift_type={gift_type} reason={request.reason or ''}:"
            f" {account.remark or account.userid}"
        )
    )
    db.add(log)
    db.commit()

    account.token = _decrypt_account_token(account.token)
    return account


@router.post("/{account_id}/clear-cooldown", response_model=AccountResponse)
def clear_account_cooldown(
    account_id: int,
    request: AccountClearCooldownRequest = AccountClearCooldownRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """手动清除账号礼物领取冷却；未指定 gift_type 时清除两类。"""
    account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")

    gift_type = None
    if request.gift_type is not None:
        gift_type = _normalize_gift_type(request.gift_type)
    _clear_account_cooldown(account, gift_type)
    db.commit()
    db.refresh(account)

    type_label = gift_type or "meituan+live"
    log = OperationLog(
        user_id=current_user.id,
        action="clear_account_cooldown",
        target_type="account",
        target_id=account.id,
        details=f"清除冷却 gift_type={type_label}: {account.remark or account.userid}"
    )
    db.add(log)
    db.commit()

    account.token = _decrypt_account_token(account.token)
    return account

