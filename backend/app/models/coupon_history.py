from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class CouponHistory(Base):
    """券码变更历史记录表

    用于记录券码变更历史，支持变码检测和旧券码追溯功能。
    当美团券码发生变更时，系统自动记录旧券码到新券码的映射关系。
    """
    __tablename__ = "coupon_history"

    id = Column(Integer, primary_key=True, index=True)
    coupon_id = Column(Integer, ForeignKey("coupons.id"), nullable=False, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("mt_accounts.id"), nullable=False, index=True)
    old_coupon_code = Column(String(100), nullable=False, index=True)  # 旧券码
    new_coupon_code = Column(String(100), nullable=False, index=True)  # 新券码
    changed_at = Column(DateTime, default=datetime.now, index=True)  # 变更时间
    change_reason = Column(String(50), default='auto_detect')  # 变更原因

    # Relationships
    coupon = relationship("Coupon", back_populates="history")
    order = relationship("Order", back_populates="coupon_history")
    account = relationship("MTAccount", back_populates="coupon_history")

    # 复合索引
    __table_args__ = (
        Index('idx_coupon_history_order_time', 'order_id', 'changed_at'),
        Index('idx_old_to_new', 'old_coupon_code', 'new_coupon_code'),
    )
