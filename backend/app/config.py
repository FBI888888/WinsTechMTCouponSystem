from typing import Optional, List
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    APP_NAME: str = "MT Coupon System"
    DEBUG: bool = True

    # Database
    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_USER: str = "root"
    DB_PASSWORD: str = ""  # 从环境变量读取
    DB_NAME: str = "mt_coupon"

    # JWT
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Node.js path for signature
    NODE_PATH: str = "node"

    # Scanner config
    SCAN_INTERVAL_MINUTES: int = 30
    SCAN_REQUEST_INTERVAL: float = 0.7
    SCAN_MAX_RETRIES: int = 3

    # Proxy config
    PROXY_PORT: int = 8888

    # Rate Limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_PER_MINUTE: int = 100  # 每分钟最大请求数
    RATE_LIMIT_LOGIN_PER_MINUTE: int = 5  # 登录接口每分钟最大请求数

    # Token Encryption
    TOKEN_ENCRYPTION_ENABLED: bool = False
    ENCRYPTION_KEY: str = ""  # 用于Token加密的密钥

    class Config:
        env_file = ".env"


settings = Settings()
