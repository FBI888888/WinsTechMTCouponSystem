from typing import List, Optional
import time
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.log import OperationLog, LoginLog, ScheduledTaskLog
from app.deps import get_current_admin_user

# 分批删除配置
BATCH_DELETE_SIZE = 1000  # 每批删除数量
BATCH_DELETE_DELAY = 0.1  # 批次间延迟（秒），让出资源


def batch_delete_safe(db: Session, model, batch_size: int = BATCH_DELETE_SIZE) -> dict:
    """
    分批删除数据，避免长事务锁表
    Args:
        db: 数据库会话
        model: 要删除的模型类
        batch_size: 每批删除数量
    Returns:
        删除统计信息
    """
    total_deleted = 0
    batch_count = 0

    while True:
        # 使用 delete with limit
        # 先查询要删除的ID，再批量删除
        ids_to_delete = db.query(model.id).limit(batch_size).all()
        id_list = [id_tuple[0] for id_tuple in ids_to_delete]

        if not id_list:
            break

        deleted = db.query(model).filter(model.id.in_(id_list)).delete(synchronize_session=False)
        db.commit()

        total_deleted += deleted
        batch_count += 1

        if deleted < batch_size:
            break

        # 批次间延迟，让出数据库资源
        time.sleep(BATCH_DELETE_DELAY)

    return {
        "total_deleted": total_deleted,
        "batch_count": batch_count
    }

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("/operations")
def get_operation_logs(
    skip: int = 0,
    limit: int = 20,
    user_id: Optional[int] = None,
    action: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    query = db.query(OperationLog)

    if user_id:
        query = query.filter(OperationLog.user_id == user_id)
    if action:
        query = query.filter(OperationLog.action == action)
    if start_date:
        from datetime import datetime
        query = query.filter(OperationLog.created_at >= datetime.fromisoformat(start_date))
    if end_date:
        from datetime import datetime
        query = query.filter(OperationLog.created_at <= datetime.fromisoformat(end_date))

    # 优化：先查数据，count 延迟到需要时再查
    items = query.order_by(OperationLog.created_at.desc()).offset(skip).limit(limit + 1).all()

    # 如果返回的数据比请求的多，说明还有更多数据
    has_more = len(items) > limit
    if has_more:
        items = items[:limit]

    # 只在第一页时计算总数
    total = None
    if skip == 0:
        # 使用更快的估算方式
        total = db.query(OperationLog.id).filter(
            OperationLog.user_id == user_id if user_id else True,
            OperationLog.action == action if action else True
        ).count() if (user_id or action) else len(items)

    return {"total": total or (skip + len(items) + (1 if has_more else 0)), "items": items, "has_more": has_more}


@router.get("/logins")
def get_login_logs(
    skip: int = 0,
    limit: int = 20,
    user_id: Optional[int] = None,
    login_status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    query = db.query(LoginLog)

    if user_id:
        query = query.filter(LoginLog.user_id == user_id)
    if login_status:
        query = query.filter(LoginLog.login_status == login_status)

    items = query.order_by(LoginLog.created_at.desc()).offset(skip).limit(limit + 1).all()

    has_more = len(items) > limit
    if has_more:
        items = items[:limit]

    total = None
    if skip == 0:
        total = db.query(LoginLog.id).filter(
            LoginLog.user_id == user_id if user_id else True,
            LoginLog.login_status == login_status if login_status else True
        ).count() if (user_id or login_status) else len(items)

    return {"total": total or (skip + len(items) + (1 if has_more else 0)), "items": items, "has_more": has_more}


@router.get("/scheduled-tasks")
def get_scheduled_task_logs(
    skip: int = 0,
    limit: int = 20,
    task_name: Optional[str] = None,
    status: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """获取定时任务日志"""
    query = db.query(ScheduledTaskLog)

    if task_name:
        query = query.filter(ScheduledTaskLog.task_name == task_name)
    if status:
        query = query.filter(ScheduledTaskLog.status == status)
    if start_date:
        from datetime import datetime
        query = query.filter(ScheduledTaskLog.started_at >= datetime.fromisoformat(start_date))
    if end_date:
        from datetime import datetime
        query = query.filter(ScheduledTaskLog.started_at <= datetime.fromisoformat(end_date))

    items = query.order_by(ScheduledTaskLog.started_at.desc()).offset(skip).limit(limit + 1).all()

    has_more = len(items) > limit
    if has_more:
        items = items[:limit]

    total = None
    if skip == 0:
        total = db.query(ScheduledTaskLog.id).filter(
            ScheduledTaskLog.task_name == task_name if task_name else True,
            ScheduledTaskLog.status == status if status else True
        ).count() if (task_name or status) else len(items)

    return {"total": total or (skip + len(items) + (1 if has_more else 0)), "items": items, "has_more": has_more}


@router.get("/scheduled-tasks/{task_id}")
def get_scheduled_task_detail(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """获取定时任务详情"""
    import json
    task = db.query(ScheduledTaskLog).filter(ScheduledTaskLog.id == task_id).first()
    if not task:
        return {"success": False, "error": "任务不存在"}
    
    result = {
        "id": task.id,
        "task_name": task.task_name,
        "status": task.status,
        "accounts_scanned": task.accounts_scanned,
        "orders_found": task.orders_found,
        "coupons_queried": task.coupons_queried,
        "error_message": task.error_message,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "finished_at": task.finished_at.isoformat() if task.finished_at else None,
        "duration_seconds": task.duration_seconds,
        "scan_details": []
    }
    
    # 解析扫描详情
    if task.scan_details:
        try:
            result["scan_details"] = json.loads(task.scan_details)
        except:
            result["scan_details"] = []
    
    return {"success": True, "data": result}


@router.delete("/operations")
def clear_operation_logs(
    days: Optional[int] = None,  # 可选：只清除指定天数前的日志
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """
    清空操作日志（分批删除，避免锁表）
    Args:
        days: 可选，只清除指定天数前的日志，不传则清空全部
    """
    from datetime import datetime, timedelta

    if days:
        cutoff_date = datetime.now() - timedelta(days=days)
        # 分批删除指定日期前的日志
        total_deleted = 0
        batch_count = 0

        while True:
            ids_to_delete = db.query(OperationLog.id).filter(
                OperationLog.created_at < cutoff_date
            ).limit(BATCH_DELETE_SIZE).all()
            id_list = [id_tuple[0] for id_tuple in ids_to_delete]

            if not id_list:
                break

            deleted = db.query(OperationLog).filter(
                OperationLog.id.in_(id_list)
            ).delete(synchronize_session=False)
            db.commit()

            total_deleted += deleted
            batch_count += 1

            if deleted < BATCH_DELETE_SIZE:
                break

            time.sleep(BATCH_DELETE_DELAY)

        return {
            "message": f"已清除 {days} 天前的操作日志",
            "total_deleted": total_deleted,
            "batch_count": batch_count
        }
    else:
        # 清空全部日志
        result = batch_delete_safe(db, OperationLog)
        return {
            "message": "操作日志已清空",
            **result
        }


@router.delete("/logins")
def clear_login_logs(
    days: Optional[int] = None,  # 可选：只清除指定天数前的日志
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """
    清空登录日志（分批删除，避免锁表）
    Args:
        days: 可选，只清除指定天数前的日志，不传则清空全部
    """
    from datetime import datetime, timedelta

    if days:
        cutoff_date = datetime.now() - timedelta(days=days)
        total_deleted = 0
        batch_count = 0

        while True:
            ids_to_delete = db.query(LoginLog.id).filter(
                LoginLog.created_at < cutoff_date
            ).limit(BATCH_DELETE_SIZE).all()
            id_list = [id_tuple[0] for id_tuple in ids_to_delete]

            if not id_list:
                break

            deleted = db.query(LoginLog).filter(
                LoginLog.id.in_(id_list)
            ).delete(synchronize_session=False)
            db.commit()

            total_deleted += deleted
            batch_count += 1

            if deleted < BATCH_DELETE_SIZE:
                break

            time.sleep(BATCH_DELETE_DELAY)

        return {
            "message": f"已清除 {days} 天前的登录日志",
            "total_deleted": total_deleted,
            "batch_count": batch_count
        }
    else:
        result = batch_delete_safe(db, LoginLog)
        return {
            "message": "登录日志已清空",
            **result
        }


@router.delete("/scheduled-tasks")
def clear_scheduled_task_logs(
    days: Optional[int] = None,  # 可选：只清除指定天数前的日志
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """
    清空定时任务日志（分批删除，避免锁表）
    Args:
        days: 可选，只清除指定天数前的日志，不传则清空全部
    """
    from datetime import datetime, timedelta

    if days:
        cutoff_date = datetime.now() - timedelta(days=days)
        total_deleted = 0
        batch_count = 0

        while True:
            ids_to_delete = db.query(ScheduledTaskLog.id).filter(
                ScheduledTaskLog.started_at < cutoff_date
            ).limit(BATCH_DELETE_SIZE).all()
            id_list = [id_tuple[0] for id_tuple in ids_to_delete]

            if not id_list:
                break

            deleted = db.query(ScheduledTaskLog).filter(
                ScheduledTaskLog.id.in_(id_list)
            ).delete(synchronize_session=False)
            db.commit()

            total_deleted += deleted
            batch_count += 1

            if deleted < BATCH_DELETE_SIZE:
                break

            time.sleep(BATCH_DELETE_DELAY)

        return {
            "message": f"已清除 {days} 天前的定时任务日志",
            "total_deleted": total_deleted,
            "batch_count": batch_count
        }
    else:
        result = batch_delete_safe(db, ScheduledTaskLog)
        return {
            "message": "定时任务日志已清空",
            **result
        }
