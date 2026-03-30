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


class CouponQueryResponse(BaseModel):
    coupon_code: str
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


class CouponBackendQueryResponse(BaseModel):
    """后端查询券码的响应"""
    coupon_code: str
    order_view_id: Optional[str] = None
    gift_id: Optional[str] = None
    userid: Optional[str] = None
    coupon_status: Optional[str] = None
    verify_time: Optional[str] = None
    verify_poi_name: Optional[str] = None
    # 状态
    status: str
    message: str


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
