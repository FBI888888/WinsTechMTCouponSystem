from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.database import Base


class NativeCredentialRefreshJob(Base):
    __tablename__ = "native_credential_refresh_jobs"

    id = Column(String(64), primary_key=True)
    requested_by = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("mt_accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    result_account_id = Column(Integer, ForeignKey("mt_accounts.id", ondelete="SET NULL"), nullable=True)
    remark = Column(String(100), nullable=True)
    instance_id = Column(String(64), nullable=False)
    instance_code = Column(String(24), nullable=False, index=True)
    instance_name = Column(String(255), nullable=True)
    agent_name = Column(String(120), nullable=True)
    state = Column(String(20), nullable=False, default="pending", index=True)
    step = Column(String(32), nullable=False, default="pending")
    phone_task_id = Column(String(64), nullable=True)
    code_task_id = Column(String(64), nullable=True)
    active_instance_code = Column(String(24), nullable=True, unique=True)
    active_account_id = Column(Integer, nullable=True, unique=True)
    worker_id = Column(String(64), nullable=True, index=True)
    lease_expires_at = Column(DateTime, nullable=True, index=True)
    error_code = Column(String(64), nullable=True)
    error_message = Column(String(500), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.now, index=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)

