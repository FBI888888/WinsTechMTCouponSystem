from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional, List, Any, Dict


class OrderBase(BaseModel):
    order_id: str
    order_view_id: Optional[str] = None
    title: Optional[str] = None
    order_amount: Optional[float] = None
    commission_fee: Optional[float] = None
    total_coupon_num: Optional[int] = None
    order_status: Optional[int] = None  # tousestatus: 1=待使用
    showstatus: Optional[str] = None
    catename: Optional[str] = None
    is_gift: Optional[bool] = False
    order_pay_time: Optional[datetime] = None
    city_name: Optional[str] = None
    consume_city_name: Optional[str] = None
    coupon_query_status: Optional[int] = 0  # 券码查询状态: 0=待查询, 1=成功, 2=失败


class OrderResponse(OrderBase):
    id: int
    account_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OrderListResponse(BaseModel):
    total: int
    items: list[OrderResponse]


class OrderSaveRequest(BaseModel):
    account_id: int
    orders: List[Dict[str, Any]]


class CouponSaveRequest(BaseModel):
    account_id: int
    order_id: int
    order_view_id: Optional[str] = None
    coupon_data: Optional[Dict[str, Any]] = None
    raw_data: Optional[Dict[str, Any]] = None
