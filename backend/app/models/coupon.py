from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base


class Coupon(Base):
    __tablename__ = "coupons"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("mt_accounts.id"), nullable=False, index=True)
    coupon_code = Column(String(100), index=True)
    encode = Column(String(100))
    coupon_status = Column(String(50))
    use_status = Column(Integer)
    gift_id = Column(String(50), index=True)
    query_time = Column(DateTime, default=datetime.now, index=True)
    raw_data = Column(JSON)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    order = relationship("Order", back_populates="coupons")
    account = relationship("MTAccount", back_populates="coupons")
    history = relationship("CouponHistory", back_populates="coupon", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("order_id", "coupon_code", name="uq_coupons_order_coupon_code"),
        Index("idx_coupons_account_query_time", "account_id", "query_time"),
    )
