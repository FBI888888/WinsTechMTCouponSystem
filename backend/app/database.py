from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import settings

# 添加 MySQL 连接参数优化远程连接
SQLALCHEMY_DATABASE_URL = (
    f"mysql+pymysql://{settings.DB_USER}:{settings.DB_PASSWORD}"
    f"@{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}"
    f"?charset=utf8mb4"
    f"&connect_timeout=10"      # 连接超时10秒
    f"&read_timeout=30"         # 读取超时30秒
    f"&write_timeout=30"        # 写入超时30秒
)

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,      # 连接前检查有效性（重要：防止使用断开的连接）
    pool_recycle=1800,       # 连接回收时间（30分钟，比MySQL wait_timeout短）
    pool_size=10,            # 常驻连接数（远程数据库不需要太多）
    max_overflow=20,         # 最大溢出连接数
    pool_timeout=30,         # 获取连接超时时间（秒）
    pool_use_lifo=True,      # 使用LIFO，让空闲连接更容易被复用
    echo=settings.DEBUG
)

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
