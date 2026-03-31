from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class OperationLog(Base):
    __tablename__ = "operation_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String(50), index=True)
    target_type = Column(String(20))
    target_id = Column(Integer)
    details = Column(Text)
    ip_address = Column(String(50))
    created_at = Column(DateTime, default=datetime.now, index=True)

    # Relationships
    user = relationship("User", back_populates="operation_logs")


class LoginLog(Base):
    __tablename__ = "login_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    username = Column(String(50))
    ip_address = Column(String(50))
    user_agent = Column(String(255))
    login_status = Column(String(20), index=True)  # success, failed
    fail_reason = Column(String(255))
    created_at = Column(DateTime, default=datetime.now, index=True)

    # Relationships
    user = relationship("User", back_populates="login_logs")


class ScheduledTaskLog(Base):
    """定时任务日志"""
    __tablename__ = "scheduled_task_logs"

    id = Column(Integer, primary_key=True, index=True)
    task_name = Column(String(50), index=True)  # 任务名称：scan_coupons, check_accounts 等
    status = Column(String(20), index=True)  # running, success, failed
    accounts_scanned = Column(Integer, default=0)  # 扫描账号数
    orders_found = Column(Integer, default=0)  # 发现订单数
    coupons_queried = Column(Integer, default=0)  # 查询券码数
    error_message = Column(Text)  # 错误信息
    started_at = Column(DateTime, default=datetime.now)  # 开始时间
    finished_at = Column(DateTime)  # 结束时间
    duration_seconds = Column(Integer)  # 耗时（秒）
    scan_details = Column(Text)  # JSON格式：扫描详情（订单号、账号userid、券码等）

    __table_args__ = (
        Index('idx_task_started', 'task_name', 'started_at'),
    )
