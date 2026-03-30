# WinsTechMT Coupon System 性能优化改进计划

> 本文档面向千万级数据量的业务场景，针对前后端交互、数据库操作等方面进行全面优化分析。

---

## 一、数据库层面优化

### 1.1 索引优化

#### 当前问题
| 表名 | 缺失索引 | 影响 |
|------|----------|------|
| `orders` | `order_status` | 状态筛选全表扫描 |
| `orders` | `coupon_query_status` | 券码查询状态更新效率低 |
| `coupons` | `coupon_status` | 券码状态查询效率低 |
| `coupons` | `use_status` | 使用状态查询效率低 |
| `scheduled_task_logs` | `(status, started_at)` | 运行中任务查询慢 |

#### 优化方案
```sql
-- 添加复合索引
ALTER TABLE orders ADD INDEX idx_order_status (order_status);
ALTER TABLE orders ADD INDEX idx_coupon_query_status (coupon_query_status);
ALTER TABLE orders ADD INDEX idx_account_status (account_id, order_status);

ALTER TABLE coupons ADD INDEX idx_coupon_status (coupon_status);
ALTER TABLE coupons ADD INDEX idx_use_status (use_status);
ALTER TABLE coupons ADD INDEX idx_order_coupon (order_id, coupon_code);

ALTER TABLE scheduled_task_logs ADD INDEX idx_status_started (status, started_at);
```

### 1.2 LIKE 查询优化

#### 当前问题
`orders.py` 第35-45行存在前导通配符查询：
```python
query = query.filter(Order.showstatus.like('%待消费%'))
```
**影响**：无法使用索引，千万级数据时全表扫描耗时严重。

#### 优化方案
1. **方案A - 新增枚举字段（推荐）**：
   - 在 `Order` 模型中添加 `order_status_enum` 字段
   - 使用整数枚举替代字符串匹配
   - 配合索引实现 O(log n) 查询
   - **优先级提升至 P0**

2. **方案B - 全文索引**：
   ```sql
   ALTER TABLE orders ADD FULLTEXT INDEX ft_showstatus (showstatus);
   ```
   适用于模糊搜索场景，但维护成本较高

### 1.3 N+1 查询优化

#### 当前问题
| 文件 | 位置 | 问题 |
|------|------|------|
| `scanner.py` | 第319-366行 | 循环查询每个账号的订单 |
| `scanner.py` | 第76-98行 | `filter_new_orders` 循环查询 |
| `deps.py` | 第91行 | 每次请求都查询用户 |

#### 优化方案
```python
# 使用 selectinload 预加载关联数据（推荐，避免笛卡尔积）
from sqlalchemy.orm import selectinload

query = db.query(Order).options(
    selectinload(Order.account),
    selectinload(Order.coupons)
)

# 批量查询替代循环查询
order_ids = [order.id for order in orders]
existing = db.query(Order.order_id).filter(
    Order.order_id.in_(order_ids)
).all()
```

### 1.4 COUNT 查询优化

#### 当前问题
分页时先执行 COUNT 再查询数据，大表时双倍耗时。

#### 优化方案
1. **估算总数**（适用于大数据量）：
   ```sql
   SELECT table_rows FROM information_schema.tables
   WHERE table_name = 'orders';
   ```

2. **缓存计数**：将总数缓存到 Redis，定期更新

3. **游标分页**：使用 `created_at` 或 `id` 进行游标分页，避免 COUNT

### 1.5 分页限制

#### 当前问题
默认 `limit=100`，无上限保护，可能被滥用导致内存溢出。

#### 优化方案
```python
MAX_PAGE_SIZE = 50

def get_orders(limit: int = 20, ...):
    limit = min(limit, MAX_PAGE_SIZE)  # 强制上限
```

### 1.6 IN 查询分批处理（新增）

#### 当前问题
`orders.py` 第102-105行：
```python
existing_orders = db.query(Order).filter(
    Order.account_id == request.account_id,
    Order.order_id.in_(order_ids)  # 若 order_ids 超过1000个会性能骤降
).all()
```

#### 优化方案
```python
# 分批查询，每批最多500个
BATCH_SIZE = 500
existing_orders = []
for i in range(0, len(order_ids), BATCH_SIZE):
    batch = order_ids[i:i+BATCH_SIZE]
    existing_orders.extend(
        db.query(Order).filter(
            Order.account_id == request.account_id,
            Order.order_id.in_(batch)
        ).all()
    )
```

### 1.7 深度分页优化（新增）

#### 当前问题
`orders.py` 第53行：
```python
items = query.order_by(Order.order_pay_time.desc()).offset(skip).limit(limit).all()
# 当 skip=100000 时，MySQL 需要扫描并丢弃前100000条记录
```

#### 优化方案
```sql
-- 方案1: 游标分页（推荐）
WHERE order_pay_time < '上一页最后一条的时间' ORDER BY order_pay_time DESC LIMIT 50;

-- 方案2: 延迟关联
SELECT o.* FROM orders o
INNER JOIN (SELECT id FROM orders ORDER BY order_pay_time DESC LIMIT 100000, 50) t
ON o.id = t.id;
```

### 1.8 日志表分区策略（新增）

#### 当前问题
日志表数据量增长快，查询效率下降。

#### 优化方案
```sql
-- 按月分区（千万级数据必须）
ALTER TABLE operation_logs PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p202601 VALUES LESS THAN (TO_DAYS('2026-02-01')),
    PARTITION p202602 VALUES LESS THAN (TO_DAYS('2026-03-01')),
    PARTITION p202603 VALUES LESS THAN (TO_DAYS('2026-04-01')),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);

-- 定期添加新分区
ALTER TABLE operation_logs ADD PARTITION (
    PARTITION p202604 VALUES LESS THAN (TO_DAYS('2026-05-01'))
);

-- 删除旧分区（比 DELETE 快得多）
ALTER TABLE operation_logs DROP PARTITION p202601;
```

---

## 二、缓存机制优化

### 2.1 认证缓存

#### 当前问题
`deps.py` 每次请求都查询数据库验证用户。

#### 优化方案
```
+--------+     +-------+     +------+
| Request| --> | Redis | --> | DB   |
+--------+     +-------+     +------+
                Cache HIT    Cache MISS
                直接返回     查询并缓存
```

**实现要点**：
- Key: `user:{user_id}:info`
- TTL: 与 JWT 过期时间一致
- 失效策略: 用户信息变更时主动删除

**补充：JWT 黑名单机制**：
```python
# 用户登出时将 Token 加入黑名单
def logout(token: str):
    payload = jwt.decode(token, SECRET_KEY)
    expire = payload.get("exp") - time.time()
    redis.setex(f"token_blacklist:{token}", expire, "1")

# 验证时检查黑名单
def verify_token(token: str):
    if redis.exists(f"token_blacklist:{token}"):
        raise HTTPException(status_code=401, detail="Token已失效")
    # 正常验证流程...
```

### 2.2 系统配置缓存

#### 当前问题
`scanner.py` 每次扫描都读取配置，频繁查库。

#### 优化方案
```python
# 使用内存缓存 + 过期时间
from functools import lru_cache
from datetime import datetime, timedelta

_config_cache = {}
_config_cache_time = {}

def get_config(key: str, ttl: int = 300):
    now = datetime.now()
    if key in _config_cache:
        if now - _config_cache_time[key] < timedelta(seconds=ttl):
            return _config_cache[key]
    # 查询数据库并缓存
    value = db.query(SystemConfig).filter(...).first()
    _config_cache[key] = value
    _config_cache_time[key] = now
    return value
```

### 2.3 API Key 验证缓存

#### 当前问题
每次 API 请求都查询 `api_keys` 表。

#### 优化方案
- 使用 Redis 缓存 API Key 信息
- Key: `api_key:{key_hash}:info`
- TTL: 5分钟
- 失效策略: Key 变更/撤销时删除

---

## 三、前后端交互优化

### 3.1 批量操作 API

#### 当前问题
| 操作 | 当前方式 | 请求数 |
|------|----------|--------|
| 检查全部账号 | 循环调用 | 2N 次 |
| 批量删除账号 | 循环调用 | N 次 |
| 保存设置 | 循环调用 | N 次 |

#### 优化方案
新增批量 API：
```python
# 后端新增接口
POST /api/accounts/batch-delete
{
    "ids": [1, 2, 3]
}

POST /api/accounts/batch-check
{
    "accounts": [{"id": 1, "userid": "...", "token": "..."}]
}

POST /api/settings/batch
{
    "configs": [
        {"key": "scan_interval", "value": "30"},
        {"key": "scan_request_interval", "value": "0.7"}
    ]
}
```

**补充：返回值规范**：
```python
class BatchDeleteResponse(BaseModel):
    success_count: int
    failed_count: int
    failed_ids: List[int]
    message: str

@router.post("/batch-delete", response_model=BatchDeleteResponse)
def batch_delete_accounts(ids: List[int], db: Session = Depends(get_db)):
    success_ids = []
    failed_ids = []
    for id in ids:
        try:
            # 删除逻辑
            success_ids.append(id)
        except Exception:
            failed_ids.append(id)

    return BatchDeleteResponse(
        success_count=len(success_ids),
        failed_count=len(failed_ids),
        failed_ids=failed_ids,
        message=f"成功删除 {len(success_ids)} 条，失败 {len(failed_ids)} 条"
    )
```

### 3.2 请求去重

#### 当前问题
- 快速点击可能发送重复请求
- 页面切换时请求未取消

#### 优化方案
```javascript
// 封装请求去重装饰器
const pendingRequests = new Map()

function dedupeRequest(key, requestFn) {
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key)
  }
  const promise = requestFn().finally(() => {
    pendingRequests.delete(key)
  })
  pendingRequests.set(key, promise)
  return promise
}
```

### 3.3 请求取消

#### 当前问题
页面切换时，未完成的请求无法取消。

#### 优化方案
```javascript
// 使用 AbortController
const controller = new AbortController()

api.get('/api/accounts', {
  signal: controller.signal
})

// 页面卸载时取消
useEffect(() => {
  return () => controller.abort()
}, [])
```

### 3.4 响应数据精简

#### 当前问题
- `GET /api/accounts` 返回完整 token，数据量大
- `GET /api/orders` 返回所有字段

#### 优化方案
```python
# 使用 Pydantic 的 exclude 排除敏感/大字段
class AccountListResponse(BaseModel):
    id: int
    remark: str
    userid: str
    status: str
    # 不返回完整 token
    token_preview: str = Field(exclude=True)

    class Config:
        from_attributes = True
```

### 3.5 API 速率限制（新增）

#### 当前问题
无速率限制，可能被恶意请求攻击导致服务崩溃。

#### 优化方案
```python
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

# 全局限流中间件
@app.middleware("http")
@limiter.limit("100/minute")
async def rate_limit_middleware(request: Request, call_next):
    return await call_next(request)

# 针对敏感接口单独限流
@router.post("/login")
@limiter.limit("5/minute")  # 登录接口每分钟最多5次
def login(request: Request, ...):
    pass
```

---

## 四、前端性能优化

### 4.1 虚拟列表

#### 当前问题
订单列表直接渲染所有行，大数据量时卡顿。

#### 优化方案
使用 `react-window` + `react-virtualized-auto-sizer` 实现自适应高度虚拟滚动：
```javascript
import { FixedSizeList } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'

<AutoSizer>
  {({ height, width }) => (
    <FixedSizeList
      height={height}
      itemCount={orders.length}
      itemSize={50}
      width={width}
    >
      {({ index, style }) => (
        <div style={style}>
          {/* 订单行内容 */}
        </div>
      )}
    </FixedSizeList>
  )}
</AutoSizer>
```

### 4.2 组件 Memoization

#### 当前问题
列表项未使用 `React.memo`，任意更新触发全部重渲染。

#### 优化方案
```javascript
// 提取行组件并使用 memo
const OrderRow = React.memo(({ order }) => {
  return (
    <tr>
      <td>{order.order_id}</td>
      {/* ... */}
    </tr>
  )
}, (prevProps, nextProps) => {
  // 自定义比较逻辑
  return prevProps.order.id === nextProps.order.id
    && prevProps.order.order_status === nextProps.order.order_status
})
```

### 4.3 缓存失效策略

#### 当前问题
- 缓存永久有效，无过期时间
- 单条数据更新清除全部缓存

#### 优化方案
```javascript
// 添加 TTL 和细粒度失效
const CACHE_TTL = 5 * 60 * 1000 // 5分钟

const useDataStore = create((set, get) => ({
  accounts: [],
  accountsLoaded: false,
  accountsLoadTime: null,

  setAccounts: (accounts) => set({
    accounts,
    accountsLoaded: true,
    accountsLoadTime: Date.now()
  }),

  isAccountsCacheValid: () => {
    const { accountsLoaded, accountsLoadTime } = get()
    if (!accountsLoaded) return false
    return Date.now() - accountsLoadTime < CACHE_TTL
  },

  invalidateAccount: (accountId) => {
    const { accounts } = get()
    // 只更新特定账号，不清除全部
    set({
      accounts: accounts.map(a =>
        a.id === accountId ? null : a
      ).filter(Boolean)
    })
  }
}))
```

### 4.4 Toast 定时器修复

#### 当前问题
`Toast.jsx` 的 `useEffect` 定时器管理逻辑错误。

#### 优化方案
```javascript
// 使用单独的 ToastItem 组件管理定时器
function ToastItem({ toast, onRemove }) {
  useEffect(() => {
    if (toast.duration) {
      const timer = setTimeout(() => {
        onRemove(toast.id)
      }, toast.duration)
      return () => clearTimeout(timer)
    }
  }, [toast.id, toast.duration, onRemove])

  return <div>{toast.message}</div>
}
```

### 4.5 券码查询并行化（新增）

#### 当前问题
`OrderListPage.jsx` 第265-323行串行查询券码：
```javascript
for (let i = 0; i < orders.length; i++) {
    const result = await window.electronAPI.rebateQueryOne(...)  // 串行查询
}
```

#### 优化方案
```javascript
// 使用 Promise.all 并发控制
const queryWithConcurrency = async (items, concurrency = 3) => {
    const results = []
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency)
        const batchResults = await Promise.all(
            batch.map(item => window.electronAPI.rebateQueryOne(item))
        )
        results.push(...batchResults)

        // 更新进度
        setQueryProgress({
            current: Math.min(i + concurrency, items.length),
            total: items.length,
            message: `正在查询 ${Math.min(i + concurrency, items.length)}/${items.length}...`
        })
    }
    return results
}

// 使用示例
const results = await queryWithConcurrency(orders, 3)  // 最多3个并发
```

### 4.6 导出功能优化（新增）

#### 当前问题
`OrderListPage.jsx` 第366-386行：
```javascript
const handleExport = async () => {
    const rows = orders.map(order => [...])  // 只导出当前页，且大数据量时内存溢出
}
```

#### 优化方案
```javascript
// 方案1: 后端生成Excel文件并返回下载链接（推荐）
const handleExport = async () => {
    const response = await ordersApi.exportExcel({
        account_id: selectedAccountId,
        status_filter: statusFilter
    })
    // 直接下载文件
    window.open(response.data.download_url)
}

// 方案2: 前端分批导出
const handleExport = async () => {
    const BATCH_SIZE = 1000
    const allRows = []

    for (let page = 0; page * BATCH_SIZE < ordersTotal; page++) {
        const data = await fetchPage(page, BATCH_SIZE)
        allRows.push(...data)

        // 避免内存溢出，分批写入
        if (allRows.length >= 5000) {
            appendToExcel(allRows)
            allRows.length = 0
        }
    }

    // 写入剩余数据
    if (allRows.length > 0) {
        appendToExcel(allRows)
    }
}
```

---

## 五、并发与异步优化

### 5.1 同步路由转异步

#### 当前问题
多数路由为同步函数，阻塞事件循环。

#### 优化方案
```python
# 使用 async session
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

@router.get("/orders")
async def get_orders(
    db: AsyncSession = Depends(get_async_db)
):
    result = await db.execute(select(Order))
    return result.scalars().all()
```

### 5.2 扫描任务并发优化

#### 当前问题
账号扫描串行执行，耗时长。

#### 优化方案
```python
import asyncio

async def run_scan_task(self, db: Session):
    accounts = db.query(MTAccount).filter(...).all()

    # 并发扫描，限制并发数
    semaphore = asyncio.Semaphore(3)  # 最多3个并发

    async def scan_with_limit(account):
        async with semaphore:
            return await self.run_scan_for_account(db, account)

    results = await asyncio.gather(*[
        scan_with_limit(account) for account in accounts
    ])
```

### 5.3 子进程优化

#### 当前问题
每次调用美团 API 都启动 Node.js 子进程，开销大。

#### 优化方案
1. **方案A - HTTP 服务（推荐）**：
   - 将 Node.js 脚本改为 HTTP 微服务
   - 使用连接池复用 HTTP 连接
   - 跨平台兼容性好

   ```javascript
   // Node.js 微服务
   const express = require('express')
   const app = express()

   app.post('/api/coupons', async (req, res) => {
       const { token, orderId } = req.body
       const result = await getCouponList(token, orderId)
       res.json(result)
   })

   app.listen(3001)
   ```

2. **方案B - 常驻进程池**：
   - 预启动多个 Node.js 进程
   - 使用进程池复用，避免重复创建
   - 注意：Windows 兼容性较差

---

## 六、安全性优化

### 6.1 敏感信息保护

#### 当前问题
`config.py` 硬编码数据库密码。

#### 优化方案
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DB_HOST: str
    DB_USER: str
    DB_PASSWORD: str

    class Config:
        env_file = ".env"  # 从环境变量读取

settings = Settings()
```

### 6.2 批量删除安全

#### 当前问题
日志清空操作无限制，可能锁表超时。

#### 优化方案
```python
def clear_logs_safely(db: Session, model, batch_size=1000):
    """分批删除，避免长事务"""
    while True:
        count = db.query(model).limit(batch_size).delete()
        db.commit()
        if count < batch_size:
            break
        time.sleep(0.1)  # 让出资源
```

### 6.3 Token 加密存储（新增）

#### 当前问题
`account.py` 第21行：
```python
token = Column(Text, nullable=False)  # 明文存储敏感Token
```

#### 优化方案
```python
from cryptography.fernet import Fernet

# 初始化加密器（密钥应存储在环境变量中）
fernet = Fernet(settings.ENCRYPTION_KEY)

# 存储 token 时加密
encrypted_token = fernet.encrypt(token.encode())
account.token = encrypted_token.decode()

# 读取 token 时解密
token = fernet.decrypt(account.token.encode()).decode()
```

### 6.4 软删除机制（新增）

#### 当前问题
数据物理删除后无法恢复，可能影响关联数据。

#### 优化方案
```python
# 添加 deleted_at 字段
class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True)
    # ... 其他字段
    deleted_at = Column(DateTime, nullable=True)

# 查询时过滤已删除
def get_orders(db: Session):
    return db.query(Order).filter(Order.deleted_at.is_(None)).all()

# 删除时设置时间戳
def soft_delete(db: Session, order_id: int):
    order = db.query(Order).get(order_id)
    order.deleted_at = datetime.now()
    db.commit()
```

---

## 七、数据库连接池优化（新增章节）

### 7.1 连接池配置

#### 当前问题
`database.py` 第11-16行：
```python
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=settings.DEBUG
)
# 缺少连接池大小配置，高并发时可能连接数不足
```

#### 优化方案
```python
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,      # 连接前检查有效性
    pool_recycle=3600,       # 连接回收时间（秒）
    pool_size=20,            # 常驻连接数
    max_overflow=30,         # 最大溢出连接数（超出pool_size后额外创建）
    pool_timeout=30,         # 获取连接超时时间（秒）
    echo=settings.DEBUG
)
```

### 7.2 连接池监控

```python
# 添加连接池状态监控
def get_pool_status():
    return {
        "pool_size": engine.pool.size(),
        "checked_in": engine.pool.checkedin(),
        "checked_out": engine.pool.checkedout(),
        "overflow": engine.pool.overflow(),
        "invalid": engine.pool.invalidatedcount()
    }

@app.get("/health/pool")
def pool_health():
    return get_pool_status()
```

---

## 八、健康检查与监控（新增章节）

### 8.1 健康检查接口增强

#### 当前问题
`main.py` 第112-114行：
```python
@app.get("/health")
def health():
    return {"status": "ok"}  # 未检查数据库连接
```

#### 优化方案
```python
from sqlalchemy import text

@app.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))  # 检查数据库连接
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
```

### 8.2 监控告警指标

| 指标 | 阈值 | 告警级别 | 说明 |
|------|------|----------|------|
| API响应时间 P99 | >500ms | Warning | 接口性能下降 |
| API响应时间 P99 | >2s | Critical | 严重影响用户体验 |
| 数据库慢查询 | >1s | Warning | 需要优化SQL |
| 数据库慢查询 | >5s | Critical | 可能导致服务不可用 |
| 扫描任务失败率 | >10% | Critical | 检查账号状态 |
| 账号Token失效数 | >5/小时 | Info | 关注账号状态 |
| 连接池使用率 | >80% | Warning | 考虑扩容 |
| 内存使用率 | >85% | Warning | 可能OOM |

### 8.3 日志聚合

```python
# 结构化日志输出
import json

class JSONFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno
        })

# 配置日志
handler = logging.StreamHandler()
handler.setFormatter(JSONFormatter())
logging.root.addHandler(handler)
```

---

## 九、数据归档策略（新增章节）

### 9.1 归档规则

| 表名 | 归档周期 | 保留策略 | 归档方式 |
|------|----------|----------|----------|
| `operation_logs` | 月度 | 热数据3个月 | 分区删除 |
| `login_logs` | 月度 | 热数据6个月 | 分区删除 |
| `scheduled_task_logs` | 月度 | 热数据3个月 | 分区删除 |
| `orders` | 年度 | 热数据2年 | 归档表 |

### 9.2 归档实现

```sql
-- 创建归档表
CREATE TABLE orders_archive LIKE orders;

-- 归档2年前的数据
INSERT INTO orders_archive
SELECT * FROM orders
WHERE order_pay_time < DATE_SUB(NOW(), INTERVAL 2 YEAR);

-- 删除已归档数据（使用分区更高效）
DELETE FROM orders
WHERE order_pay_time < DATE_SUB(NOW(), INTERVAL 2 YEAR)
LIMIT 10000;  -- 分批删除
```

---

## 十、实施优先级

### P0 - 立即执行（1-2周）
| 序号 | 优化项 | 预期效果 | 风险 |
|------|--------|----------|------|
| 1 | 添加数据库索引 | 查询性能提升 10-100 倍 | 低 |
| 2 | 日志清空分批删除 | 避免生产事故 | 低 |
| 3 | API 速率限制 | 防止恶意请求 | 低 |
| 4 | 批量操作 API | 减少请求次数 N → 1 | 中 |
| 5 | 虚拟列表 | 大数据量渲染流畅 | 中 |
| 6 | 敏感信息移至环境变量 | 安全合规 | 低 |

### P1 - 短期执行（2-4周）
| 序号 | 优化项 | 预期效果 | 风险 |
|------|--------|----------|------|
| 7 | 认证/配置缓存 | 减少数据库压力 | 中 |
| 8 | Token 加密存储 | 安全合规 | 中 |
| 9 | IN 查询分批处理 | 大批量操作性能 | 低 |
| 10 | 数据库连接池优化 | 高并发稳定性 | 低 |
| 11 | N+1 查询优化 | 扫描任务效率提升 | 中 |
| 12 | 请求去重/取消 | 避免重复请求 | 低 |

### P2 - 中期执行（1-2月）
| 序号 | 优化项 | 预期效果 | 风险 |
|------|--------|----------|------|
| 13 | 同步路由转异步 | 并发能力提升 | 高 |
| 14 | 扫描任务并发 | 任务耗时缩短 | 中 |
| 15 | 组件 Memoization | 渲染性能提升 | 低 |
| 16 | 缓存 TTL 策略 | 数据一致性 | 中 |
| 17 | 日志表分区 | 千万级数据查询性能 | 中 |
| 18 | 深度分页优化 | 大数据分页性能 | 中 |

### P3 - 长期规划（3-6月）
| 序号 | 优化项 | 预期效果 | 风险 |
|------|--------|----------|------|
| 19 | HTTP 微服务替代子进程 | API 调用效率 | 高 |
| 20 | 游标分页 | 大数据分页优化 | 中 |
| 21 | 监控告警体系 | 可观测性 | 中 |
| 22 | 数据归档策略 | 存储成本优化 | 中 |
| 23 | 软删除机制 | 数据安全 | 低 |

---

## 十一、性能指标目标

| 指标 | 当前 | 目标 | 优化后验收标准 |
|------|------|------|----------------|
| 订单列表查询（100万数据） | >5s | <500ms | P99 < 300ms |
| 账号扫描（100个账号） | >10min | <2min | 并发优化后 |
| 首页加载时间 | >3s | <1s | LCP < 1.5s |
| API 响应时间 P99 | >2s | <200ms | 排除外部API调用 |
| 数据库 QPS | ~100 | >1000 | 连接池优化后 |
| 连接池使用率峰值 | N/A | <70% | 监控告警阈值 |

---

## 十二、风险评估

| 风险项 | 影响 | 概率 | 应对措施 |
|--------|------|------|----------|
| 索引添加影响写入性能 | 写入变慢 | 中 | 在低峰期执行，监控写入延迟 |
| 缓存一致性问题 | 数据不一致 | 中 | 使用合理的 TTL + 主动失效 |
| 异步改造复杂度高 | 开发周期长 | 高 | 分阶段迁移，保持向后兼容 |
| 虚拟列表改造成本 | UI 变化大 | 中 | 统一封装列表组件 |
| 进程池 Windows 兼容性 | 功能异常 | 高 | 优先使用 HTTP 服务方案 |
| 加密存储性能损耗 | 响应变慢 | 低 | 使用对称加密，密钥缓存 |

---

## 十三、配置管理优化（新增章节）

### 13.1 硬编码配置外部化

#### 当前问题
`frontend/src/api/index.js` 第7行：
```javascript
timeout: 120000  // 硬编码2分钟超时
```

#### 优化方案
```javascript
// 使用环境变量
const API_CONFIG = {
    timeout: parseInt(import.meta.env.VITE_API_TIMEOUT) || 30000,
    baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
}

// 创建 axios 实例
const api = axios.create({
    baseURL: API_CONFIG.baseUrl,
    timeout: API_CONFIG.timeout
})
```

### 13.2 配置文件模板

```bash
# .env.example
# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_NAME=mt_coupon
DB_USER=root
DB_PASSWORD=your_password_here

# 安全配置
SECRET_KEY=your_secret_key_here
ENCRYPTION_KEY=your_encryption_key_here

# API 配置
API_TIMEOUT=30000
API_RATE_LIMIT=100

# 扫描配置
SCAN_INTERVAL_MINUTES=30
SCAN_REQUEST_INTERVAL=0.7
```

---

*文档创建时间：2026-03-30*
*最后更新时间：2026-03-30*
*适用版本：WinsTechMT Coupon System v1.0*
