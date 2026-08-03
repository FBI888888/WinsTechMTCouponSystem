from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional, Literal


GiftType = Literal["meituan", "live"]


class AccountBase(BaseModel):
    remark: Optional[str] = None
    userid: str
    token: str
    url: Optional[str] = None
    csecuuid: Optional[str] = None
    open_id: Optional[str] = None
    open_id_cipher: Optional[str] = None
    platform: Optional[str] = "windows"


class AccountCreate(AccountBase):
    user_id: Optional[int] = None


class AccountUpdate(BaseModel):
    remark: Optional[str] = None
    userid: Optional[str] = None
    token: Optional[str] = None
    url: Optional[str] = None
    csecuuid: Optional[str] = None
    open_id: Optional[str] = None
    open_id_cipher: Optional[str] = None
    platform: Optional[str] = None
    status: Optional[str] = None
    disabled: Optional[int] = None


class AccountResponse(AccountBase):
    id: int
    user_id: Optional[int]
    platform: str = "windows"
    status: str
    disabled: int = 0
    last_check_time: Optional[datetime]
    last_scan_time: Optional[datetime] = None
    cooldown_until: Optional[datetime] = None
    last_claim_at: Optional[datetime] = None
    last_limit_at: Optional[datetime] = None
    cooldown_until_meituan: Optional[datetime] = None
    cooldown_until_live: Optional[datetime] = None
    last_claim_at_meituan: Optional[datetime] = None
    last_claim_at_live: Optional[datetime] = None
    last_limit_at_meituan: Optional[datetime] = None
    last_limit_at_live: Optional[datetime] = None
    meituan_claim_count: int = 0
    live_claim_count: int = 0
    today_meituan_claim_count: int = 0
    today_live_claim_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AccountCaptureRequest(BaseModel):
    remark: str
    userid: str
    token: str
    url: str
    status: Optional[str] = None
    csecuuid: Optional[str] = None
    open_id: Optional[str] = None
    open_id_cipher: Optional[str] = None
    platform: Optional[str] = "windows"


class AccountCheckRequest(BaseModel):
    userid: str
    token: str


class AccountCheckResponse(BaseModel):
    success: bool
    code: Optional[int] = None
    message: Optional[str] = None


class AccountCooldownRequest(BaseModel):
    hours: float = 12
    reason: Optional[str] = "1011"
    gift_type: GiftType = "meituan"


class AccountClearCooldownRequest(BaseModel):
    """gift_type 缺省时清除美团与直播两类冷却。"""
    gift_type: Optional[GiftType] = None


class GiftClaimSaveRequest(BaseModel):
    account_id: int
    gift_id: Optional[str] = None
    gift_id_encrypt_hash: Optional[str] = None
    order_id: Optional[str] = None
    coupon_code: Optional[str] = None
    encode: Optional[str] = None
    coupon_status: Optional[str] = None
    use_status: Optional[int] = None
    title: Optional[str] = None
    raw_data: Optional[dict] = None
    data_source: str = "wxbot_gift_submit"
    gift_type: GiftType = "meituan"


class ClaimRecordItem(BaseModel):
    id: int
    coupon_code: Optional[str] = None
    gift_id: Optional[str] = None
    gift_id_encrypt_hash: Optional[str] = None
    order_id: Optional[str] = None
    order_db_id: Optional[int] = None
    account_id: int
    account_userid: Optional[str] = None
    account_remark: Optional[str] = None
    coupon_status: Optional[str] = None
    coupon_query_status: int = 0
    use_status: Optional[int] = None
    data_source: Optional[str] = None
    query_time: Optional[datetime] = None
    created_at: Optional[datetime] = None


class ClaimRecordListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[ClaimRecordItem]