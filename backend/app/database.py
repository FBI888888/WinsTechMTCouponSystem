from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import settings
import logging
import time

logger = logging.getLogger(__name__)

# 添加 MySQL 连接参数优化远程连接
SQLALCHEMY_DATABASE_URL = (
    f"mysql+pymysql://{settings.DB_USER}:{settings.DB_PASSWORD}"
    f"@{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}"
    f"?charset=utf8mb4"
    f"&connect_timeout=5"       # 连接超时5秒（减少等待）
    f"&read_timeout=10"         # 读取超时10秒
    f"&write_timeout=10"        # 写入超时10秒
)

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,      # 连接前检查有效性
    pool_recycle=1800,       # 连接回收时间（30分钟）
    pool_size=5,             # 减少常驻连接数
    max_overflow=10,         # 最大溢出连接数
    pool_timeout=10,         # 获取连接超时时间（秒）
    pool_use_lifo=True,      # 使用LIFO，让空闲连接更容易被复用
    echo=settings.DEBUG
)

# 添加连接池事件监听
@event.listens_for(engine, "checkout")
def receive_checkout(dbapi_connection, connection_record, connection_proxy):
    logger.debug("DB connection checkout")

@event.listens_for(engine, "checkin")
def receive_checkin(dbapi_connection, connection_record):
    logger.debug("DB connection checkin")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database tables"""
    Base.metadata.create_all(bind=engine)
