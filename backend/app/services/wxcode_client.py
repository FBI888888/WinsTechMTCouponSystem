from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.services.native_integration_config import load_native_integration_config


class WxcodeOpenAPIError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int = 502):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class WxcodeOpenAPIClient:
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        enabled: bool | None = None,
    ):
        if base_url is None and api_key is None and enabled is None:
            runtime = load_native_integration_config()
            self.base_url = runtime.service_url
            self.api_key = runtime.api_key
            self.enabled = runtime.enabled
        else:
            self.base_url = str(base_url if base_url is not None else settings.WXCODE_SERVICE_URL).strip().rstrip("/")
            self.api_key = str(api_key if api_key is not None else settings.WXCODE_SERVICE_API_KEY).strip()
            self.enabled = bool(settings.NATIVE_ACCOUNT_ENABLED if enabled is None else enabled)

    def validate_configuration(self) -> None:
        if not self.enabled:
            raise WxcodeOpenAPIError("NATIVE_DISABLED", "Native 账号功能尚未启用", 503)
        if not self.base_url or not self.api_key:
            raise WxcodeOpenAPIError("WXCODE_NOT_CONFIGURED", "调度中心地址或 API Key 未配置", 503)
        if not settings.DEBUG and not self.base_url.lower().startswith("https://"):
            raise WxcodeOpenAPIError("WXCODE_HTTPS_REQUIRED", "生产环境调度中心必须使用 HTTPS", 503)
        if not settings.DEBUG and not settings.TOKEN_ENCRYPTION_ENABLED:
            raise WxcodeOpenAPIError("TOKEN_ENCRYPTION_REQUIRED", "生产环境启用 Native 前必须开启凭据加密", 503)
        if not settings.DEBUG and (
            not settings.ENCRYPTION_KEY
            or settings.ENCRYPTION_KEY.startswith("your_")
            or settings.ENCRYPTION_KEY.startswith("replace_")
        ):
            raise WxcodeOpenAPIError(
                "STABLE_ENCRYPTION_KEY_REQUIRED",
                "生产环境启用 Native 前必须配置长期稳定且非占位的 ENCRYPTION_KEY",
                503,
            )

    async def _request(self, method: str, path: str, *, json_body: dict | None = None) -> dict[str, Any]:
        self.validate_configuration()
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=httpx.Timeout(20.0, connect=8.0),
            ) as client:
                response = await client.request(method, path, json=json_body)
        except httpx.TimeoutException as exc:
            raise WxcodeOpenAPIError("WXCODE_TIMEOUT", "调度中心请求超时", 504) from exc
        except httpx.HTTPError as exc:
            raise WxcodeOpenAPIError("WXCODE_UNAVAILABLE", "无法连接调度中心", 502) from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise WxcodeOpenAPIError("WXCODE_BAD_RESPONSE", "调度中心返回了无效响应", 502) from exc

        if response.status_code >= 400:
            detail = payload.get("error") or payload.get("detail") or {}
            if isinstance(detail, dict) and "detail" in detail and isinstance(detail["detail"], dict):
                detail = detail["detail"]
            if isinstance(detail, dict):
                code = str(detail.get("code") or payload.get("code") or f"WXCODE_HTTP_{response.status_code}")
                message = str(detail.get("message") or payload.get("message") or "调度中心请求失败")
            else:
                code = str(payload.get("code") or f"WXCODE_HTTP_{response.status_code}")
                message = str(detail or payload.get("message") or "调度中心请求失败")
            raise WxcodeOpenAPIError(code, message[:300], response.status_code)
        if not isinstance(payload, dict):
            raise WxcodeOpenAPIError("WXCODE_BAD_RESPONSE", "调度中心返回格式错误", 502)
        return payload

    async def ping(self) -> dict[str, Any]:
        return await self._request("GET", "/api/v1/ping")

    async def instances(self) -> list[dict[str, Any]]:
        payload = await self._request("GET", "/api/v1/instances")
        values = payload.get("instances")
        return values if isinstance(values, list) else []

    async def submit_task(self, *, instance_code: str, kind: str, request_id: str) -> str:
        payload = await self._request("POST", "/api/v1/code-tasks", json_body={
            "instance_code": instance_code,
            "appid": "wxde8ac0a21135c07d",
            "kind": "phone" if kind == "phone" else "code",
            "client_request_id": request_id,
        })
        task_id = str(payload.get("task_id") or "")
        if not task_id:
            raise WxcodeOpenAPIError("WXCODE_BAD_RESPONSE", "调度中心未返回任务 ID")
        return task_id

    async def task(self, task_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/api/v1/code-tasks/{task_id}")

    async def cancel(self, task_id: str) -> None:
        try:
            await self._request("DELETE", f"/api/v1/code-tasks/{task_id}")
        except WxcodeOpenAPIError as exc:
            if exc.code not in {"TASK_NOT_ACTIVE", "TASK_NOT_FOUND"}:
                raise
