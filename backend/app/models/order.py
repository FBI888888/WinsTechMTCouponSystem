from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Index, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("mt_accounts.id"), nullable=False, index=True)
    order_id = Column(String(50), nullable=False, index=True)
    order_view_id = Column(String(50))
    title = Column(String(200))
    order_amount = Column(Numeric(10, 2))
    commission_fee = Column(Numeric(10, 2))
    total_coupon_num = Column(Integer)
    order_status = Column(Integer)
    order_status_bucket = Column(String(20), nullable=False)
    showstatus = Column(String(50))
    catename = Column(String(50))
    is_gift = Column(Boolean, default=False)
    order_pay_time = Column(DateTime, index=True)
    city_name = Column(String(50))
    consume_city_name = Column(String(50))
    coupon_query_status = Column(Integer, default=0)
    gift_return_status = Column(Integer, default=0)
    gift_return_message = Column(String(255))
    gift_return_updated_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    account = relationship("MTAccount", back_populates="orders")
    coupons = relationship("Coupon", back_populates="order")
    coupon_history = relationship("CouponHistory", back_populates="order")

    __table_args__ = (
        UniqueConstraint("account_id", "order_id", name="uq_orders_account_order_id"),
        Index("idx_orders_account_order_view_id", "account_id", "order_view_id"),
        Index("idx_orders_account_paytime_id", "account_id", "order_pay_time", "id"),
        Index(
            "idx_orders_account_status_bucket_paytime_id",
            "account_id",
            "order_status_bucket",
            "order_pay_time",
            "id",
        ),
        Index(
            "idx_orders_account_coupon_query_paytime_id",
            "account_id",
            "coupon_query_status",
            "order_pay_time",
            "id",
        ),
    )
