from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models.config import SystemConfig
from app.utils.encryption import decrypt_token, encrypt_token


CONFIG_NATIVE_ENABLED = "native_account_enabled"
CONFIG_WXCODE_SERVICE_URL = "wxcode_service_url"
CONFIG_WXCODE_SERVICE_API_KEY = "wxcode_service_api_key"
NATIVE_CONFIG_CATEGORY = "native_integration"
NATIVE_CONFIG_KEYS = {
    CONFIG_NATIVE_ENABLED,
    CONFIG_WXCODE_SERVICE_URL,
    CONFIG_WXCODE_SERVICE_API_KEY,
}


@dataclass(frozen=True)
class NativeIntegrationRuntimeConfig:
    enabled: bool
    service_url: str
    api_key: str
    enabled_source: str
    service_url_source: str
    api_key_source: str

    @property
    def configured(self) -> bool:
        return bool(self.service_url and self.api_key)


def _as_bool(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def load_native_integration_config(
    db: Optional[Session] = None,
) -> NativeIntegrationRuntimeConfig:
    """Load UI-managed Native settings, with environment values as fallback."""
    owns_session = db is None
    if db is None:
        db = SessionLocal()
    try:
        rows = db.query(SystemConfig).filter(
            SystemConfig.config_key.in_(NATIVE_CONFIG_KEYS)
        ).all()
        values = {row.config_key: row.config_value for row in rows}

        if CONFIG_NATIVE_ENABLED in values:
            enabled = _as_bool(values[CONFIG_NATIVE_ENABLED])
            enabled_source = "database"
        else:
            enabled = bool(settings.NATIVE_ACCOUNT_ENABLED)
            enabled_source = "environment"

        if CONFIG_WXCODE_SERVICE_URL in values:
            service_url = str(values[CONFIG_WXCODE_SERVICE_URL] or "").strip().rstrip("/")
            service_url_source = "database"
        else:
            service_url = str(settings.WXCODE_SERVICE_URL or "").strip().rstrip("/")
            service_url_source = "environment"

        if CONFIG_WXCODE_SERVICE_API_KEY in values:
            api_key = decrypt_token(str(values[CONFIG_WXCODE_SERVICE_API_KEY] or "")).strip()
            api_key_source = "database"
        else:
            api_key = str(settings.WXCODE_SERVICE_API_KEY or "").strip()
            api_key_source = "environment"

        return NativeIntegrationRuntimeConfig(
            enabled=enabled,
            service_url=service_url,
            api_key=api_key,
            enabled_source=enabled_source,
            service_url_source=service_url_source,
            api_key_source=api_key_source,
        )
    finally:
        if owns_session:
            db.close()


def upsert_native_config(
    db: Session,
    *,
    key: str,
    value: str,
    config_type: str,
    description: str,
) -> None:
    if key not in NATIVE_CONFIG_KEYS:
        raise ValueError("Unsupported Native configuration key")
    row = db.query(SystemConfig).filter(SystemConfig.config_key == key).first()
    if row is None:
        row = SystemConfig(config_key=key)
        db.add(row)
    row.config_value = value
    row.config_type = config_type
    row.category = NATIVE_CONFIG_CATEGORY
    row.is_public = False
    row.description = description


def encrypt_native_api_key(api_key: str) -> str:
    if not settings.TOKEN_ENCRYPTION_ENABLED:
        raise RuntimeError("保存调度中心 API Key 前必须启用凭据加密")
    encrypted = encrypt_token(str(api_key or "").strip())
    if encrypted == str(api_key or "").strip():
        raise RuntimeError("调度中心 API Key 加密失败")
    return encrypted
