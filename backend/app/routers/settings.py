from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.config import SystemConfig
from app.deps import get_current_admin_user
from app.services.notification import WechatNotifier

router = APIRouter(prefix="/api/settings", tags=["settings"])


class ConfigItem(BaseModel):
    config_key: str
    config_value: Optional[str] = None
    config_type: Optional[str] = "string"
    category: Optional[str] = None
    is_public: Optional[bool] = False
    description: Optional[str] = None


class ConfigResponse(ConfigItem):
    id: int
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


@router.get("", response_model=List[ConfigResponse])
def get_configs(
    category: Optional[str] = None,
    include_public_only: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    query = db.query(SystemConfig)
    if category:
        query = query.filter(SystemConfig.category == category)
    if include_public_only:
        query = query.filter(SystemConfig.is_public == True)
    return query.all()


@router.get("/{config_key}", response_model=ConfigResponse)
def get_config(
    config_key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    config = db.query(SystemConfig).filter(SystemConfig.config_key == config_key).first()
    if not config:
        raise HTTPException(status_code=404, detail="Config not found")
    return config


@router.put("/{config_key}")
def update_config(
    config_key: str,
    config: ConfigItem,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    db_config = db.query(SystemConfig).filter(SystemConfig.config_key == config_key).first()
    if not db_config:
        db_config = SystemConfig(config_key=config_key)
        db.add(db_config)

    db_config.config_value = config.config_value
    db_config.config_type = config.config_type or db_config.config_type
    db_config.category = config.category or db_config.category
    db_config.is_public = config.is_public if config.is_public is not None else db_config.is_public
    db_config.description = config.description or db_config.description

    db.commit()
    return {"message": "Config updated successfully"}


@router.post("")
def create_config(
    config: ConfigItem,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    existing = db.query(SystemConfig).filter(SystemConfig.config_key == config.config_key).first()
    if existing:
        raise HTTPException(status_code=400, detail="Config key already exists")

    db_config = SystemConfig(
        config_key=config.config_key,
        config_value=config.config_value,
        config_type=config.config_type,
        category=config.category,
        is_public=config.is_public,
        description=config.description
    )
    db.add(db_config)
    db.commit()
    return {"message": "Config created successfully"}


@router.delete("/{config_key}")
def delete_config(
    config_key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    config = db.query(SystemConfig).filter(SystemConfig.config_key == config_key).first()
    if not config:
        raise HTTPException(status_code=404, detail="Config not found")

    db.delete(config)
    db.commit()
    return {"message": "Config deleted successfully"}


@router.post("/trigger-scan")
async def trigger_scan_manually(
    current_user: User = Depends(get_current_admin_user)
):
    """手动触发定时扫描任务"""
    from app.services.meituan.scanner import run_scheduled_scan

    # 异步执行扫描任务
    result = await run_scheduled_scan()

    return {
        "message": "Scan task completed",
        "result": result
    }


class WechatTestRequest(BaseModel):
    message: Optional[str] = "这是一条测试消息"


@router.get("/wechat/config")
def get_wechat_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """获取微信通知配置"""
    from app.services.notification import (
        CONFIG_WECHAT_FROM_WXID,
        CONFIG_WECHAT_TO_WXID,
        CONFIG_WECHAT_ENABLED
    )

    configs = db.query(SystemConfig).filter(
        SystemConfig.category == "notification"
    ).all()

    result = {}
    for config in configs:
        result[config.config_key] = {
            "value": config.config_value,
            "description": config.description
        }

    return result


@router.post("/wechat/test")
async def test_wechat_notification(
    request: WechatTestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """测试微信消息通知"""
    notifier = WechatNotifier(db)

    content = (
        f"🧪 美团券码系统 - 测试消息\n"
        f"━━━━━━━━━━━━━━━\n"
        f"{request.message}\n"
        f"━━━━━━━━━━━━━━━\n"
        f"发送时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    )

    success = await notifier.send_message(content)

    if success:
        return {"message": "测试消息发送成功"}
    else:
        raise HTTPException(
            status_code=400,
            detail="测试消息发送失败，请检查微信配置"
        )
