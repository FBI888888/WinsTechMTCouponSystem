from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class NativeRefreshJobCreate(BaseModel):
    account_id: Optional[int] = None
    remark: Optional[str] = Field(default=None, max_length=100)
    instance_id: str = Field(min_length=1, max_length=64)
    instance_code: str = Field(min_length=1, max_length=24)

    @model_validator(mode="after")
    def validate_new_account(self):
        self.instance_id = self.instance_id.strip()
        self.instance_code = self.instance_code.strip().upper()
        if self.account_id is None and not str(self.remark or "").strip():
            raise ValueError("remark is required for a new Native account")
        return self


class NativeRefreshJobResponse(BaseModel):
    job_id: str
    account_id: Optional[int] = None
    result_account_id: Optional[int] = None
    state: str
    step: str
    instance_id: str
    instance_code: str
    instance_name: Optional[str] = None
    agent_name: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class NativeInstanceResponse(BaseModel):
    instance_id: str
    instance_code: str
    name: str = ""
    agent_name: str = ""
    enabled: bool = False
    state: str = "unknown"
    session_ready: bool = False

