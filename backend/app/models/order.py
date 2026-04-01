from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Boolean, Index
from sqlalchemy.orm import relationship
from datetime import datetime
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
    order_status = Column(Integer)  # tousestatus: 1=待使用, 0=其他
    showstatus = Column(String(50))  # 原始状态文本
    catename = Column(String(50))  # 分类名称
    is_gift = Column(Boolean, default=False)  # 是否为礼物订单
    order_pay_time = Column(DateTime, index=True)
    city_name = Column(String(50))
    consume_city_name = Column(String(50))
    coupon_query_status = Column(Integer, default=0)  # 券码查询状态: 0=待查询, 1=成功, 2=失败
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    # Relationships
    account = relationship("MTAccount", back_populates="orders")
    coupons = relationship("Coupon", back_populates="order")
    coupon_history = relationship("CouponHistory", back_populates="order")

    # 复合索引
    __table_args__ = (
        Index('idx_account_orderid', 'account_id', 'order_id'),
    )
