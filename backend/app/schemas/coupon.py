from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional, List


class CouponBase(BaseModel):
    coupon_code: Optional[str] = None
    coupon_status: Optional[str] = None  # 改为字符串，存储状态文本
    encode: Optional[str] = None
    use_status: Optional[int] = None
    gift_id: Optional[str] = None


class CouponResponse(CouponBase):
    id: int
    order_id: int
    account_id: int
    query_time: datetime

    model_config = ConfigDict(from_attributes=True)


class CouponQueryRequest(BaseModel):
    coupon_codes: list[str]


class CouponChangeInfo(BaseModel):
    """券码变更信息"""
    is_changed: bool = False
    change_count: int = 0
    old_coupon_code: Optional[str] = None  # 旧券码
    last_change_time: Optional[datetime] = None  # 最后变更时间


class CouponQueryResponse(BaseModel):
    coupon_code: str  # 用户输入的券码
    current_coupon_code: Optional[str] = None  # 当前实际券码（如果有变更）
    order_id: Optional[int] = None
    order_view_id: Optional[str] = None  # 订单号
    gift_id: Optional[str] = None
    # 账号信息，用于前端调用美团API
    userid: Optional[str] = None
    token: Optional[str] = None
    csecuuid: Optional[str] = None
    open_id: Optional[str] = None
    open_id_cipher: Optional[str] = None
    # 状态
    status: str
    message: str
    # 券码信息（如果已查询过）
    coupon_status: Optional[str] = None
    raw_data: Optional[dict] = None
    # 变更信息
    is_old_code: bool = False  # 是否通过旧券码匹配
    change_info: Optional[CouponChangeInfo] = None  # 变更信息


class CouponBackendQueryResponse(BaseModel):
    """后端查询券码的响应"""
    coupon_code: str  # 用户输入的券码
    current_coupon_code: Optional[str] = None  # 当前实际券码
    order_view_id: Optional[str] = None
    gift_id: Optional[str] = None
    userid: Optional[str] = None
    coupon_status: Optional[str] = None
    verify_time: Optional[str] = None
    verify_poi_name: Optional[str] = None
    # 状态
    status: str
    message: str
    # 变更信息
    is_old_code: bool = False  # 是否通过旧券码匹配
    code_changed: bool = False  # 本次查询是否检测到变更
    change_type: str = 'none'  # 变更类型: none/partial/full
    old_coupon_code: Optional[str] = None  # 旧券码（如有变更）
    change_count: int = 0  # 历史变更次数


class CouponBatchUpdateItem(BaseModel):
    """批量更新券码的单项数据"""
    coupon_code: str
    coupon_status: Optional[str] = None
    use_status: Optional[int] = None
    verify_time: Optional[str] = None
    verify_poi_name: Optional[str] = None


class CouponBatchUpdateRequest(BaseModel):
    """批量更新券码请求"""
    coupons: List[CouponBatchUpdateItem]


class CouponHistoryResponse(BaseModel):
    """券码历史记录响应"""
    id: int
    coupon_id: int
    order_id: int
    old_coupon_code: str
    new_coupon_code: str
    changed_at: datetime
    change_reason: str

    model_config = ConfigDict(from_attributes=True)
