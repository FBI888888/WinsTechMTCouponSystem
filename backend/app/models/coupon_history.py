from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class CouponHistory(Base):
    __tablename__ = "coupon_history"

    id = Column(Integer, primary_key=True, index=True)
    coupon_id = Column(Integer, ForeignKey("coupons.id"), nullable=False, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("mt_accounts.id"), nullable=False, index=True)
    old_coupon_code = Column(String(100), nullable=False, index=True)
    new_coupon_code = Column(String(100), nullable=False, index=True)
    changed_at = Column(DateTime, default=datetime.now, index=True)
    change_reason = Column(String(50), default="auto_detect")

    coupon = relationship("Coupon", back_populates="history")
    order = relationship("Order", back_populates="coupon_history")
    account = relationship("MTAccount", back_populates="coupon_history")

    __table_args__ = (
        Index("idx_coupon_history_coupon_changed_id", "coupon_id", "changed_at", "id"),
        Index("idx_coupon_history_old_changed_id", "old_coupon_code", "changed_at", "id"),
    )
