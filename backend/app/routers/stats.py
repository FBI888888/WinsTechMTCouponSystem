import logging
import threading
import time

from fastapi import APIRouter, Depends
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models.account import AccountStatus, MTAccount
from app.models.coupon import Coupon
from app.models.order import Order
from app.models.user import User
from app.utils.order_status import COMPLETED_STATUS_BUCKET, PENDING_STATUS_BUCKET


router = APIRouter(prefix="/api/stats", tags=["stats"])
logger = logging.getLogger(__name__)

_dashboard_cache_lock = threading.Lock()
_dashboard_cache_payload = None
_dashboard_cache_expires_at = 0.0


def invalidate_dashboard_stats_cache() -> None:
    global _dashboard_cache_payload, _dashboard_cache_expires_at
    with _dashboard_cache_lock:
        _dashboard_cache_payload = None
        _dashboard_cache_expires_at = 0.0


def _get_cached_dashboard_payload():
    with _dashboard_cache_lock:
        if _dashboard_cache_payload is None:
            return None
        if time.time() >= _dashboard_cache_expires_at:
            return None
        return _dashboard_cache_payload


def _set_cached_dashboard_payload(payload: dict) -> None:
    global _dashboard_cache_payload, _dashboard_cache_expires_at
    with _dashboard_cache_lock:
        _dashboard_cache_payload = payload
        _dashboard_cache_expires_at = time.time() + settings.DASHBOARD_CACHE_TTL_SECONDS


def _aggregate_account_stats(db: Session) -> dict:
    row = db.query(
        func.count(MTAccount.id).label("total"),
        func.sum(case((MTAccount.status == AccountStatus.NORMAL, 1), else_=0)).label("normal"),
        func.sum(case((MTAccount.status == AccountStatus.INVALID, 1), else_=0)).label("invalid"),
        func.sum(case((MTAccount.disabled == 1, 1), else_=0)).label("disabled"),
    ).one()

    return {
        "total": int(row.total or 0),
        "normal": int(row.normal or 0),
        "invalid": int(row.invalid or 0),
        "disabled": int(row.disabled or 0),
    }


def _aggregate_order_stats(db: Session) -> dict:
    pending_condition = Order.order_status_bucket == PENDING_STATUS_BUCKET
    completed_condition = Order.order_status_bucket == COMPLETED_STATUS_BUCKET

    row = db.query(
        func.count(Order.id).label("total"),
        func.sum(case((pending_condition, 1), else_=0)).label("pending"),
        func.sum(case((completed_condition, 1), else_=0)).label("completed"),
    ).one()

    return {
        "total": int(row.total or 0),
        "pending": int(row.pending or 0),
        "completed": int(row.completed or 0),
    }


def _aggregate_coupon_stats(db: Session) -> dict:
    row = db.query(
        func.count(Coupon.id).label("total"),
        func.sum(case((Coupon.use_status == 1, 1), else_=0)).label("pending"),
        func.sum(case((Coupon.use_status == 3, 1), else_=0)).label("used"),
    ).one()

    return {
        "total": int(row.total or 0),
        "pending": int(row.pending or 0),
        "used": int(row.used or 0),
    }


@router.get("/dashboard")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取仪表盘统计数据。
    用聚合查询替代多次 count，并使用短 TTL 缓存减轻首页高频访问压力。
    """
    started_at = time.perf_counter()

    cached_payload = _get_cached_dashboard_payload()
    if cached_payload is not None:
        duration_ms = (time.perf_counter() - started_at) * 1000
        logger.info("[P1][dashboard_stats] cache_hit=true duration_ms=%.2f", duration_ms)
        return cached_payload

    payload = {
        "account": _aggregate_account_stats(db),
        "order": _aggregate_order_stats(db),
        "coupon": _aggregate_coupon_stats(db),
    }

    _set_cached_dashboard_payload(payload)

    duration_ms = (time.perf_counter() - started_at) * 1000
    logger.info(
        "[P1][dashboard_stats] cache_hit=false ttl_seconds=%s duration_ms=%.2f",
        settings.DASHBOARD_CACHE_TTL_SECONDS,
        duration_ms,
    )
    return payload
