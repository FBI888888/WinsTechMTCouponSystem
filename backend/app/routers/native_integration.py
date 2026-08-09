from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_admin_user, get_current_user
from app.models.account import MTAccount
from app.models.log import OperationLog
from app.models.native_refresh import NativeCredentialRefreshJob
from app.models.user import User
from app.schemas.native_refresh import (
    NativeInstanceResponse,
    NativeRefreshJobCreate,
    NativeRefreshJobResponse,
)
from app.services.native_credentials import (
    NativeRefreshConflict,
    create_native_refresh_job,
    schedule_native_refresh,
)
from app.services.native_integration_config import (
    CONFIG_NATIVE_ENABLED,
    CONFIG_WXCODE_SERVICE_API_KEY,
    CONFIG_WXCODE_SERVICE_URL,
    NativeIntegrationRuntimeConfig,
    encrypt_native_api_key,
    load_native_integration_config,
    upsert_native_config,
)
from app.services.wxcode_client import WxcodeOpenAPIClient, WxcodeOpenAPIError


router = APIRouter(tags=["native-integration"])


class NativeIntegrationConfigUpdate(BaseModel):
    enabled: bool = False
    service_url: str = Field(default="", max_length=500)
    api_key: str | None = Field(default=None, max_length=1000)
    clear_api_key: bool = False


class NativeIntegrationConfigResponse(BaseModel):
    enabled: bool
    service_url: str
    api_key_configured: bool
    configured: bool
    enabled_source: str
    service_url_source: str
    api_key_source: str


def _raise_openapi_error(exc: WxcodeOpenAPIError) -> None:
    raise HTTPException(
        status_code=exc.status_code,
        detail={"code": exc.code, "message": exc.message},
    ) from exc


def _config_response(
    value: NativeIntegrationRuntimeConfig,
) -> NativeIntegrationConfigResponse:
    return NativeIntegrationConfigResponse(
        enabled=value.enabled,
        service_url=value.service_url,
        api_key_configured=bool(value.api_key),
        configured=value.configured,
        enabled_source=value.enabled_source,
        service_url_source=value.service_url_source,
        api_key_source=value.api_key_source,
    )


@router.get(
    "/api/native-integration/config",
    response_model=NativeIntegrationConfigResponse,
)
def get_native_integration_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    del current_user
    return _config_response(load_native_integration_config(db))


@router.put(
    "/api/native-integration/config",
    response_model=NativeIntegrationConfigResponse,
)
def update_native_integration_config(
    body: NativeIntegrationConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    current = load_native_integration_config(db)
    service_url = str(body.service_url or "").strip().rstrip("/")
    supplied_api_key = None if body.api_key is None else body.api_key.strip()
    if body.clear_api_key and supplied_api_key:
        raise HTTPException(status_code=400, detail="不能同时填写并清除 API Key")

    candidate_api_key = (
        "" if body.clear_api_key
        else supplied_api_key if supplied_api_key
        else current.api_key
    )
    if body.enabled:
        try:
            WxcodeOpenAPIClient(
                base_url=service_url,
                api_key=candidate_api_key,
                enabled=True,
            ).validate_configuration()
        except WxcodeOpenAPIError as exc:
            _raise_openapi_error(exc)

    changed_fields = ["enabled", "service_url"]
    try:
        upsert_native_config(
            db,
            key=CONFIG_NATIVE_ENABLED,
            value="true" if body.enabled else "false",
            config_type="boolean",
            description="是否启用 Native 实例账号",
        )
        upsert_native_config(
            db,
            key=CONFIG_WXCODE_SERVICE_URL,
            value=service_url,
            config_type="string",
            description="统一调度中心 OpenAPI 地址",
        )
        if body.clear_api_key:
            upsert_native_config(
                db,
                key=CONFIG_WXCODE_SERVICE_API_KEY,
                value="",
                config_type="secret",
                description="统一调度中心 OpenAPI API Key（加密）",
            )
            changed_fields.append("api_key_cleared")
        elif supplied_api_key:
            upsert_native_config(
                db,
                key=CONFIG_WXCODE_SERVICE_API_KEY,
                value=encrypt_native_api_key(supplied_api_key),
                config_type="secret",
                description="统一调度中心 OpenAPI API Key（加密）",
            )
            changed_fields.append("api_key_replaced")

        db.add(OperationLog(
            user_id=current_user.id,
            action="update_native_config",
            target_type="native_integration",
            target_id=None,
            details="Updated Native integration fields: " + ",".join(changed_fields),
        ))
        db.commit()
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        raise

    return _config_response(load_native_integration_config(db))


def _instance_response(value: dict[str, Any]) -> NativeInstanceResponse:
    return NativeInstanceResponse(
        instance_id=str(value.get("instance_id") or value.get("id") or ""),
        instance_code=str(value.get("instance_code") or "").upper(),
        name=str(value.get("name") or ""),
        agent_name=str(value.get("agent_name") or ""),
        enabled=bool(value.get("enabled")),
        state=str(value.get("state") or "unknown"),
        session_ready=bool(value.get("session_ready")),
    )


def _job_response(job: NativeCredentialRefreshJob) -> NativeRefreshJobResponse:
    return NativeRefreshJobResponse(
        job_id=job.id,
        account_id=job.account_id,
        result_account_id=job.result_account_id,
        state=job.state,
        step=job.step,
        instance_id=job.instance_id,
        instance_code=job.instance_code,
        instance_name=job.instance_name,
        agent_name=job.agent_name,
        error_code=job.error_code,
        error_message=job.error_message,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


@router.get("/api/native-instances", response_model=list[NativeInstanceResponse])
async def list_native_instances(
    current_user: User = Depends(get_current_user),
):
    del current_user
    try:
        values = await WxcodeOpenAPIClient().instances()
    except WxcodeOpenAPIError as exc:
        _raise_openapi_error(exc)
    return [_instance_response(value) for value in values]


@router.get("/api/native-integration/health")
async def native_integration_health(
    current_user: User = Depends(get_current_admin_user),
):
    del current_user
    client = WxcodeOpenAPIClient()
    try:
        ping = await client.ping()
        instances = await client.instances()
    except WxcodeOpenAPIError as exc:
        return {
            "ok": False,
            "enabled": client.enabled,
            "configured": bool(client.base_url and client.api_key),
            "code": exc.code,
            "message": exc.message,
        }
    return {
        "ok": True,
        "enabled": True,
        "configured": True,
        "ping": ping.get("status") or ping.get("message") or "ok",
        "authorized_instances": len(instances),
    }


@router.post(
    "/api/accounts/native-refresh-jobs",
    response_model=NativeRefreshJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_refresh_job(
    body: NativeRefreshJobCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.account_id is not None:
        account = db.query(MTAccount).filter(
            MTAccount.id == body.account_id,
            MTAccount.user_id == current_user.id,
        ).first()
        if not account:
            raise HTTPException(status_code=404, detail="账号不存在或无权访问")

    try:
        values = await WxcodeOpenAPIClient().instances()
    except WxcodeOpenAPIError as exc:
        _raise_openapi_error(exc)

    instance = next(
        (
            value for value in values
            if str(value.get("instance_id") or value.get("id") or "") == body.instance_id
            and str(value.get("instance_code") or "").upper() == body.instance_code
        ),
        None,
    )
    if not instance:
        raise HTTPException(status_code=400, detail="实例不存在、未授权，或实例 ID 与串码不匹配")
    if not bool(instance.get("enabled")):
        raise HTTPException(status_code=409, detail="该实例当前未启用")

    normalized_instance = {
        "instance_id": str(instance.get("instance_id") or instance.get("id") or ""),
        "instance_code": str(instance.get("instance_code") or "").upper(),
        "name": str(instance.get("name") or ""),
        "agent_name": str(instance.get("agent_name") or ""),
    }
    try:
        job = create_native_refresh_job(
            requested_by=current_user.id,
            account_id=body.account_id,
            remark=str(body.remark or "").strip(),
            instance=normalized_instance,
        )
    except NativeRefreshConflict as exc:
        detail = {"code": "NATIVE_REFRESH_CONFLICT", "message": str(exc)}
        if exc.job_id:
            detail["job_id"] = exc.job_id
        raise HTTPException(status_code=409, detail=detail) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    schedule_native_refresh(job.id)
    return _job_response(job)


@router.get(
    "/api/accounts/native-refresh-jobs/{job_id}",
    response_model=NativeRefreshJobResponse,
)
def get_refresh_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = db.query(NativeCredentialRefreshJob).filter(
        NativeCredentialRefreshJob.id == job_id,
        NativeCredentialRefreshJob.requested_by == current_user.id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="刷新任务不存在")
    return _job_response(job)


@router.delete("/api/accounts/{account_id}/native-binding")
def delete_native_binding(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = db.query(MTAccount).filter(
        MTAccount.id == account_id,
        MTAccount.user_id == current_user.id,
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在或无权访问")
    if account.credential_source != "native":
        return {"success": True, "message": "账号已是旧方式"}

    active_refresh = db.query(NativeCredentialRefreshJob).filter(
        NativeCredentialRefreshJob.account_id == account.id,
        NativeCredentialRefreshJob.state.in_(("pending", "requesting", "waiting", "exchanging")),
    ).first()
    if active_refresh:
        raise HTTPException(status_code=409, detail="该账号正在刷新凭据，请等待任务结束后再解除绑定")

    instance_code = account.native_instance_code
    account.credential_source = "legacy"
    account.native_instance_id = None
    account.native_instance_code = None
    account.native_instance_name = None
    account.native_agent_name = None
    account.credential_refresh_status = "idle"
    account.credential_refresh_error = None
    db.add(OperationLog(
        user_id=current_user.id,
        action="delete_native_binding",
        target_type="account",
        target_id=account.id,
        details=f"Native binding removed: account={account.id} instance={instance_code or '-'}",
    ))
    db.commit()
    return {"success": True, "message": "已解除 Native 绑定，当前凭据已保留"}
