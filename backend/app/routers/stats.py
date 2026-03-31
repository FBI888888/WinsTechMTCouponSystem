from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models.user import User
from app.models.account import MTAccount, AccountStatus
from app.models.order import Order
from app.models.coupon import Coupon
from app.deps import get_current_user

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/dashboard")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取仪表盘统计数据
    使用 SQL COUNT 直接统计，性能高效
    """
    # 账号统计
    account_total = db.query(func.count(MTAccount.id)).scalar() or 0
    account_normal = db.query(func.count(MTAccount.id)).filter(
        MTAccount.status == AccountStatus.NORMAL
    ).scalar() or 0
    account_invalid = db.query(func.count(MTAccount.id)).filter(
        MTAccount.status == AccountStatus.INVALID
    ).scalar() or 0
    account_disabled = db.query(func.count(MTAccount.id)).filter(
        MTAccount.disabled == 1
    ).scalar() or 0

    # 订单统计
    order_total = db.query(func.count(Order.id)).scalar() or 0
    order_pending = db.query(func.count(Order.id)).filter(
        (Order.order_status == 1) | (Order.showstatus.like('%待消费%'))
    ).scalar() or 0
    order_completed = db.query(func.count(Order.id)).filter(
        (Order.showstatus.like('%已完成%')) | (Order.showstatus.like('%待评价%'))
    ).scalar() or 0

    # 券码统计
    coupon_total = db.query(func.count(Coupon.id)).scalar() or 0
    coupon_pending = db.query(func.count(Coupon.id)).filter(
        Coupon.use_status == 1
    ).scalar() or 0
    coupon_used = db.query(func.count(Coupon.id)).filter(
        Coupon.use_status == 3
    ).scalar() or 0

    return {
        "account": {
            "total": account_total,
            "normal": account_normal,
            "invalid": account_invalid,
            "disabled": account_disabled
        },
        "order": {
            "total": order_total,
            "pending": order_pending,
            "completed": order_completed
        },
        "coupon": {
            "total": coupon_total,
            "pending": coupon_pending,
            "used": coupon_used
        }
    }
