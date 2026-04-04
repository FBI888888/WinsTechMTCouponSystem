from pathlib import Path
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _coerce_bool_like(value):
    if isinstance(value, bool):
        return value

    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on", "debug", "dev", "development"}:
            return True
        if normalized in {"0", "false", "no", "off", "release", "prod", "production"}:
            return False

    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_NAME: str = "MT Coupon System"
    DEBUG: bool = True

    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_USER: str = "root"
    DB_PASSWORD: str = ""
    DB_NAME: str = "mt_coupon"
    DB_CONNECT_TIMEOUT_SECONDS: int = 10
    DB_READ_TIMEOUT_SECONDS: int = 60
    DB_WRITE_TIMEOUT_SECONDS: int = 60
    DB_POOL_TIMEOUT_SECONDS: int = 30

    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24

    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    NODE_PATH: str = "node"

    SCAN_INTERVAL_MINUTES: int = 30
    SCAN_REQUEST_INTERVAL: float = 0.7
    SCAN_MAX_RETRIES: int = 3
    SCAN_COUPON_QUERY_CONCURRENCY: int = 3
    SCAN_COUPON_QUERY_BATCH_SIZE: int = 6
    DASHBOARD_CACHE_TTL_SECONDS: int = 15
    ORDER_LIST_COUNT_CACHE_TTL_SECONDS: int = 15

    PROXY_PORT: int = 8888

    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_PER_MINUTE: int = 100
    RATE_LIMIT_LOGIN_PER_MINUTE: int = 5

    TOKEN_ENCRYPTION_ENABLED: bool = False
    ENCRYPTION_KEY: str = ""

    @field_validator("DEBUG", "RATE_LIMIT_ENABLED", "TOKEN_ENCRYPTION_ENABLED", mode="before")
    @classmethod
    def parse_bool_like_values(cls, value):
        return _coerce_bool_like(value)


settings = Settings()
