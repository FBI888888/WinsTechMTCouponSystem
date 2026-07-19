from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Enum, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base
import enum


class AccountStatus(str, enum.Enum):
    NORMAL = "normal"
    INVALID = "invalid"
    UNCHECKED = "unchecked"


class MTAccount(Base):
    __tablename__ = "mt_accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    remark = Column(String(100))
    userid = Column(String(50), nullable=False, index=True)
    token = Column(Text, nullable=False)
    url = Column(Text)
    csecuuid = Column(String(100))
    open_id = Column(String(100))
    open_id_cipher = Column(String(255))
    platform = Column(String(20), nullable=False, default="windows")  # android/windows/ios/harmony
    status = Column(Enum(AccountStatus, values_callable=lambda obj: [e.value for e in obj]), default=AccountStatus.UNCHECKED, index=True)
    disabled = Column(Integer, default=0, index=True)  # 0=启用, 1=禁用
    last_check_time = Column(DateTime)
    last_scan_time = Column(DateTime)  # 最后扫描时间
    cooldown_until = Column(DateTime, nullable=True, index=True)  # 兼容旧字段（同步 meituan）
    last_claim_at = Column(DateTime, nullable=True)  # 兼容旧字段（同步 meituan）
    last_limit_at = Column(DateTime, nullable=True)  # 兼容旧字段（同步 meituan）
    cooldown_until_meituan = Column(DateTime, nullable=True, index=True)  # 美团礼物冷却截止
    cooldown_until_live = Column(DateTime, nullable=True, index=True)  # 直播礼物冷却截止
    last_claim_at_meituan = Column(DateTime, nullable=True)  # 最近美团礼物领取
    last_claim_at_live = Column(DateTime, nullable=True)  # 最近直播礼物领取
    last_limit_at_meituan = Column(DateTime, nullable=True)  # 最近美团达限时间
    last_limit_at_live = Column(DateTime, nullable=True)  # 最近直播达限时间
    meituan_claim_count = Column(Integer, nullable=False, default=0)  # 美团礼物领取次数
    live_claim_count = Column(Integer, nullable=False, default=0)  # 直播礼物领取次数
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    # Relationships
    user = relationship("User", back_populates="accounts")
    orders = relationship("Order", back_populates="account")
    coupons = relationship("Coupon", back_populates="account")
    coupon_history = relationship("CouponHistory", back_populates="account")
