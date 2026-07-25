from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.account import GiftType


class GiftClaimSaveRequest(BaseModel):
    account_id: int
    gift_id: Optional[str] = None
    gift_id_encrypt_hash: Optional[str] = Field(
        default=None,
        description="SHA256(normalized giftIdEncrypt) hex",
    )
    order_id: Optional[str] = None
    coupon_code: Optional[str] = None
    encode: Optional[str] = None
    coupon_status: Optional[str] = None
    use_status: Optional[int] = None
    title: Optional[str] = None
    raw_data: Optional[dict[str, Any]] = None
    data_source: str = "wxbot_gift_submit"
    gift_type: GiftType = "meituan"


class GiftClaimResponse(BaseModel):
    id: Optional[int] = None
    found: bool
    coupon_ready: bool = False
    is_new_claim: bool = False
    account_locked: bool = False
    account_id: Optional[int] = None
    gift_id: Optional[str] = None
    gift_id_encrypt_hash: Optional[str] = None
    order_id: Optional[str] = None
    coupon_code: Optional[str] = None
    coupon_query_status: int = 0
    gift_type: Optional[str] = None
    data_source: Optional[str] = None
    order_db_id: Optional[int] = None
    coupon_id: Optional[int] = None
    claimed_at: Optional[datetime] = None
    coupon_queried_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
