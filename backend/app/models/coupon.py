from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class Coupon(Base):
    __tablename__ = "coupons"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("mt_accounts.id"), nullable=False, index=True)
    coupon_code = Column(String(100), index=True)  # 券码
    encode = Column(String(100))  # 完整券码（encode字段）
    coupon_status = Column(String(50))  # 券码状态文本：待使用、已使用等
    use_status = Column(Integer)  # 券码状态码：1=待使用, 3=已使用
    gift_id = Column(String(50), index=True)  # 礼物订单ID
    query_time = Column(DateTime, default=datetime.now, index=True)
    raw_data = Column(JSON)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    # Relationships
    order = relationship("Order", back_populates="coupons")
    account = relationship("MTAccount", back_populates="coupons")
    history = relationship("CouponHistory", back_populates="coupon", cascade="all, delete-orphan")

    # 复合索引
    __table_args__ = (
        Index('idx_coupon_order_code', 'order_id', 'coupon_code'),
    )
