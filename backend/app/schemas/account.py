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


class AccountResponse(AccountBase):
    id: int
    user_id: Optional[int]
    status: str
    last_check_time: Optional[datetime]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AccountCaptureRequest(BaseModel):
    remark: str
    userid: str
    token: str
    url: str
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
