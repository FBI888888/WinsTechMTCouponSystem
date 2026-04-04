from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict


class OrderBase(BaseModel):
    order_id: str
    order_view_id: Optional[str] = None
    title: Optional[str] = None
    order_amount: Optional[float] = None
    commission_fee: Optional[float] = None
    total_coupon_num: Optional[int] = None
    order_status: Optional[int] = None
    order_status_bucket: Optional[str] = None
    showstatus: Optional[str] = None
    catename: Optional[str] = None
    is_gift: Optional[bool] = False
    order_pay_time: Optional[datetime] = None
    city_name: Optional[str] = None
    consume_city_name: Optional[str] = None
    coupon_query_status: Optional[int] = 0


class OrderResponse(OrderBase):
    id: int
    account_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OrderListResponse(BaseModel):
    total: int
    has_more: bool = False
    pagination_mode: Optional[str] = None
    next_cursor_order_pay_time: Optional[datetime] = None
    next_cursor_id: Optional[int] = None
    prev_cursor_order_pay_time: Optional[datetime] = None
    prev_cursor_id: Optional[int] = None
    items: list[OrderResponse]


class PendingCouponQueryItem(BaseModel):
    id: int
    order_view_id: str
    coupon_query_status: int


class PendingCouponQueryResponse(BaseModel):
    returned_count: int
    has_more: bool = False
    total: Optional[int] = None
    items: list[PendingCouponQueryItem]


class OrderSaveRequest(BaseModel):
    account_id: int
    orders: List[Dict[str, Any]]


class CouponSaveRequest(BaseModel):
    account_id: int
    order_id: int
    order_view_id: Optional[str] = None
    coupon_data: Optional[Dict[str, Any]] = None
    raw_data: Optional[Dict[str, Any]] = None
