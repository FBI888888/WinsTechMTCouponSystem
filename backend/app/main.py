from fastapi import FastAPI, Request, Response, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging
import time
from datetime import datetime
from collections import defaultdict
from sqlalchemy import text
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings
from app.database import init_db, SessionLocal, get_db, engine
from app.routers import auth, accounts, users, orders, coupons, logs, settings as settings_router


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Scheduler instance
scheduler = AsyncIOScheduler()

# Rate limiting storage (simple in-memory, for production use Redis)
# Structure: {ip: {endpoint: [(timestamp, count)]}}
rate_limit_storage = defaultdict(lambda: defaultdict(list))


def check_rate_limit(ip: str, endpoint: str, limit: int, window_seconds: int = 60) -> bool:
    """
    检查速率限制
    Args:
        ip: 客户端IP
        endpoint: 端点标识
        limit: 时间窗口内最大请求数
        window_seconds: 时间窗口（秒）
    Returns:
        True=允许请求, False=超出限制
    """
    if not settings.RATE_LIMIT_ENABLED:
        return True

    now = time.time()
    window_start = now - window_seconds

    # 清理过期记录
    rate_limit_storage[ip][endpoint] = [
        t for t in rate_limit_storage[ip][endpoint] if t > window_start
    ]

    # 检查请求数
    if len(rate_limit_storage[ip][endpoint]) >= limit:
        return False

    # 记录本次请求
    rate_limit_storage[ip][endpoint].append(now)
    return True


async def scheduled_scan_job():
    """定时扫描任务"""
    logger.info("[Scheduler] Starting scheduled scan job...")
    try:
        from app.services.meituan.scanner import run_scheduled_scan
        result = await run_scheduled_scan()
        logger.info(f"[Scheduler] Scan job completed: {result}")
    except Exception as e:
        logger.error(f"[Scheduler] Scan job failed: {e}")


def setup_scheduler():
    """设置定时任务"""
    # 获取扫描间隔
    db = SessionLocal()
    try:
        from app.services.meituan.scanner import get_scan_interval_minutes
        interval = get_scan_interval_minutes(db)
    finally:
        db.close()

    logger.info(f"[Scheduler] Setting up scheduler with interval: {interval} minutes")

    # 添加定时任务
    scheduler.add_job(
        scheduled_scan_job,
        trigger=IntervalTrigger(minutes=interval),
        id='scan_coupons',
        name='Scan Coupons Task',
        replace_existing=True
    )

    scheduler.start()
    logger.info("[Scheduler] Scheduler started")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting MT Coupon System...")
    try:
        init_db()
        logger.info("Database initialized")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")

    # Start scheduler
    setup_scheduler()

    yield

    # Shutdown
    logger.info("Shutting down MT Coupon System...")
    if scheduler.running:
        scheduler.shutdown()
        logger.info("[Scheduler] Scheduler stopped")


app = FastAPI(
    title=settings.APP_NAME,
    debug=settings.DEBUG,
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Rate Limiting Middleware
@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """速率限制中间件"""
    # 获取客户端IP
    client_ip = request.client.host if request.client else "unknown"

    # 排除健康检查和静态资源
    if request.url.path in ["/", "/health", "/health/db", "/health/pool"]:
        return await call_next(request)

    # 排除内部操作接口（如批量查询订单）
    if "/pending-coupon-query" in request.url.path:
        return await call_next(request)

    # 登录接口使用更严格的限制
    if "/login" in request.url.path or "/auth" in request.url.path:
        if not check_rate_limit(client_ip, "login", settings.RATE_LIMIT_LOGIN_PER_MINUTE):
            return JSONResponse(
                status_code=429,
                content={"detail": "请求过于频繁，请稍后再试"}
            )
    else:
        # 其他接口使用默认限制
        if not check_rate_limit(client_ip, "default", settings.RATE_LIMIT_PER_MINUTE):
            return JSONResponse(
                status_code=429,
                content={"detail": "请求过于频繁，请稍后再试"}
            )

    return await call_next(request)

# Routers
app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(users.router)
app.include_router(orders.router)
app.include_router(coupons.router)
app.include_router(logs.router)
app.include_router(settings_router.router)


@app.get("/")
def root():
    return {"message": "MT Coupon System API", "version": "1.0.0"}


@app.get("/health")
def health():
    """基础健康检查"""
    return {
        "status": "ok",
        "timestamp": datetime.now().isoformat()
    }


@app.get("/health/db")
def health_db(db = Depends(get_db)):
    """数据库健康检查"""
    try:
        db.execute(text("SELECT 1"))
        return {
            "status": "ok",
            "database": "connected",
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={
                "status": "degraded",
                "database": "disconnected",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
        )


@app.get("/health/pool")
def health_pool():
    """连接池状态检查"""
    try:
        pool = engine.pool
        return {
            "status": "ok",
            "pool": {
                "size": pool.size(),
                "checked_in": pool.checkedin(),
                "checked_out": pool.checkedout(),
                "overflow": pool.overflow(),
                "invalid": pool.invalidatedcount()
            },
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
