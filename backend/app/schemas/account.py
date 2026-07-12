from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional


class AccountBase(BaseModel):
    remark: Optional[str] = None
    userid: str
    token: str
    url: Optional[str] = None
    csecuuid: Optional[str] = None
    open_id: Optional[str] = None
    open_id_cipher: Optional[str] = None


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
    status: Optional[str] = None
    disabled: Optional[int] = None


class AccountResponse(AccountBase):
    id: int
    user_id: Optional[int]
    status: str
    disabled: int = 0
    last_check_time: Optional[datetime]
    last_scan_time: Optional[datetime] = None
    cooldown_until: Optional[datetime] = None
    last_claim_at: Optional[datetime] = None
    last_limit_at: Optional[datetime] = None
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


class GiftClaimSaveRequest(BaseModel):
    account_id: int
    gift_id: str
    order_id: Optional[str] = None
    coupon_code: str
    encode: Optional[str] = None
    coupon_status: Optional[str] = None
    use_status: Optional[int] = None
    title: Optional[str] = None
    raw_data: Optional[dict] = None
    data_source: str = "wxbot_gift_submit"


class ClaimRecordItem(BaseModel):
    id: int
    coupon_code: Optional[str] = None
    gift_id: Optional[str] = None
    order_id: Optional[str] = None
    order_db_id: Optional[int] = None
    account_id: int
    account_userid: Optional[str] = None
    account_remark: Optional[str] = None
    coupon_status: Optional[str] = None
    use_status: Optional[int] = None
    data_source: Optional[str] = None
    query_time: Optional[datetime] = None
    created_at: Optional[datetime] = None


class ClaimRecordListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[ClaimRecordItem]