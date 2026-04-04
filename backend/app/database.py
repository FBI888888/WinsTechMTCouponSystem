import logging

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)

SQLALCHEMY_DATABASE_URL = (
    f"mysql+pymysql://{settings.DB_USER}:{settings.DB_PASSWORD}"
    f"@{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}"
    f"?charset=utf8mb4"
    f"&connect_timeout={settings.DB_CONNECT_TIMEOUT_SECONDS}"
    f"&read_timeout={settings.DB_READ_TIMEOUT_SECONDS}"
    f"&write_timeout={settings.DB_WRITE_TIMEOUT_SECONDS}"
)

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=5,
    max_overflow=10,
    pool_timeout=settings.DB_POOL_TIMEOUT_SECONDS,
    pool_use_lifo=True,
    echo=settings.DEBUG,
)


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
    """Initialize database tables."""
    Base.metadata.create_all(bind=engine)
    _ensure_orders_gift_return_columns()


def _ensure_orders_gift_return_columns():
    """Backfill new order columns for existing deployments without Alembic."""
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_columns = {column["name"] for column in inspector.get_columns("orders")}

        if "gift_return_status" not in existing_columns:
            conn.execute(text("ALTER TABLE orders ADD COLUMN gift_return_status INT NOT NULL DEFAULT 0"))
            logger.info("Added orders.gift_return_status column")

        if "gift_return_message" not in existing_columns:
            conn.execute(text("ALTER TABLE orders ADD COLUMN gift_return_message VARCHAR(255) NULL"))
            logger.info("Added orders.gift_return_message column")

        if "gift_return_updated_at" not in existing_columns:
            conn.execute(text("ALTER TABLE orders ADD COLUMN gift_return_updated_at DATETIME NULL"))
            logger.info("Added orders.gift_return_updated_at column")
