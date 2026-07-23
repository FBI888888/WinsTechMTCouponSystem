from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import relationship

from app.database import Base


class GiftClaim(Base):
    __tablename__ = "gift_claims"

    id = Column(Integer, primary_key=True, index=True)
    gift_id = Column(String(50), nullable=False, unique=True)
    source_order_id = Column(String(50), nullable=True, unique=True)
    account_id = Column(Integer, ForeignKey("mt_accounts.id"), nullable=False, index=True)
    order_db_id = Column(Integer, ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True)
    coupon_id = Column(Integer, ForeignKey("coupons.id", ondelete="SET NULL"), nullable=True, index=True)
    coupon_code = Column(String(100), nullable=True, index=True)
    coupon_query_status = Column(Integer, nullable=False, default=0, index=True)
    gift_type = Column(String(20), nullable=False, default="meituan", index=True)
    data_source = Column(String(32), nullable=False, default="wxbot_gift_submit", index=True)
    title = Column(String(200), nullable=True)
    raw_data = Column(JSON, nullable=True)
    claimed_at = Column(DateTime, nullable=False, default=datetime.now, index=True)
    coupon_queried_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)

    account = relationship("MTAccount", back_populates="gift_claims")
    order = relationship("Order", foreign_keys=[order_db_id])
    coupon = relationship("Coupon", foreign_keys=[coupon_id])

    __table_args__ = (
        Index("idx_gift_claims_account_claimed", "account_id", "claimed_at"),
        Index("idx_gift_claims_source_status", "data_source", "coupon_query_status"),
    )