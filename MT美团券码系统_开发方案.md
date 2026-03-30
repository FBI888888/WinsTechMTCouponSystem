# 美团账号券码扫描系统 - 完整开发方案

## 1. 项目概述

本项目是一套前后端分离的美团账号券码扫描、存储、查询系统，采用 Electron + React 构建桌面端应用，FastAPI + MySQL 构建后端服务。

### 1.1 核心功能

- **账号管理**：抓包获取Token、账号增删改查、状态检测
- **订单列表**：从数据库/接口拉取订单数据
- **券码查询**：根据券码查询订单号/礼物号和userid，调用接口查询最新状态
- **定时扫描**：自动轮询有效账户，扫描订单列表，查询券码信息落库
- **运行日志**：详细的操作日志记录
- **系统设置**：仅管理员可访问的参数配置
- **用户管理**：完整的用户CRUD功能

### 1.2 技术栈

- **前端**：Electron 28 + React 18 + Vite 5 + Ant Design 5 + TailwindCSS
- **后端**：FastAPI + SQLAlchemy + MySQL 8.0
- **认证**：JWT + 管理员角色
- **日志**：Python logging + 自定义日志服务
- **定时任务**：APScheduler

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron 桌面端                           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │ 账号管理 │  │ 订单列表 │  │ 券码查询 │  │ 系统设置 │           │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                         │
│  │ 运行日志 │  │ 用户管理 │  │ 抓包模块 │                         │
│  └─────────┘  └─────────┘  └─────────┘                         │
└───────────────────────────┬─────────────────────────────────────┘
                           │ HTTP/HTTPS (REST API)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     FastAPI 后端服务                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │ 账号API  │  │ 订单API  │  │ 券码API  │  │ 用户API  │           │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │ 定时任务 │  │ 日志服务 │  │ 代理服务 │  │ 签名服务 │           │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │
└───────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                       MySQL 数据库                               │
│  accounts  │  orders  │  coupons  │  users  │  logs  │  config  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 前后端通信

- 前端通过 HTTP REST API 与后端通信
- 抓包功能保留在 Electron 端实现（代理服务）
- 所有数据存储到 MySQL，不在本地存储

### 2.3 抓包与签名服务架构

#### 2.3.1 抓包数据上传流程

```
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│   Electron       │      │   FastAPI       │      │    MySQL        │
│   桌面端         │      │   后端服务       │      │    数据库        │
└────────┬─────────┘      └────────┬─────────┘      └──────────────────┘
         │                          │
         │  1. 用户启动抓包          │                          │
         │ ◄───────────────────────│                          │
         │                          │                          │
         │  2. 抓包获取token       │                          │
         │  userid/token           │                          │
         │  csecuuid/openId       │                          │
         │  openIdCipher          │                          │
         │ ───────────────────────►│                          │
         │                          │  3. 验证并保存到数据库   │
         │                          │ ───────────────────────► │
         │                          │                          │
         │  4. 返回保存结果         │                          │
         │ ◄───────────────────────│                          │
```

**抓包 API 接口设计：**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/accounts/capture | 上传播放员抓包数据（临时接口，需认证） |

**请求参数：**
```json
{
  "remark": "账号备注",
  "userid": "美团userId",
  "token": "美团token",
  "url": "完整URL",
  "csecuuid": "抓包获取",
  "open_id": "openId",
  "open_id_cipher": "openIdCipher"
}
```

#### 2.3.2 签名服务架构

由于美团接口签名算法（mtgsig.js）是复杂的 JavaScript 代码，采用 Node.js 子进程方式调用：

```
┌─────────────────────────────────────────────────────────────────┐
│                       FastAPI 后端服务                           │
│                                                                 │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │
│   │  Scanner    │    │  Coupon API │    │  Order API  │       │
│   │  定时扫描   │    │  券码查询   │    │  订单同步   │       │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘       │
│          │                   │                   │              │
│          └───────────────────┼───────────────────┘              │
│                              ▼                                   │
│                  ┌─────────────────────┐                        │
│                  │   Signature Service │                        │
│                  │   (签名服务)         │                        │
│                  └──────────┬──────────┘                        │
│                             │                                   │
└─────────────────────────────┼───────────────────────────────────┘
                              │ HTTP / IPC
                              ▼
                  ┌─────────────────────┐
                  │   Node.js          │
                  │   签名进程         │
                  │   (child_process)  │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │   mtgsig.js         │
                  │   签名算法          │
                  └─────────────────────┘
```

**签名服务实现：**

```python
# app/services/meituan/signature.py

import subprocess
import json
import os

class SignatureService:
    """签名服务 - 通过 Node.js 子进程调用 mtgsig.js"""

    def __init__(self):
        self.node_path = os.getenv('NODE_PATH', 'node')
        self.script_path = os.path.join(
            os.path.dirname(__file__), '..', '..', '..',
            '功能参考项目', 'mtgsig.js'
        )

    def sign(self, order_view_id, token, userid, **kwargs):
        """调用 Node.js 执行签名"""
        cmd = [
            self.node_path,
            self.script_path,
            str(order_view_id),
            token,
            userid,
            json.dumps(kwargs)
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            raise Exception(f"签名失败: {result.stderr}")

        return json.loads(result.stdout)
```

**备选方案**：如性能要求高，可单独部署 Node.js 签名服务，通过 HTTP API 调用。

---

## 3. 数据库设计

### 3.1 核心表结构

```sql
-- 用户表
CREATE TABLE `users` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `username` VARCHAR(50) UNIQUE NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('admin', 'user') DEFAULT 'user',
    `is_active` BOOLEAN DEFAULT TRUE,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 美团账号表
CREATE TABLE `mt_accounts` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `user_id` INT, -- 所属用户（可为空，系统账号不关联）
    `remark` VARCHAR(100) COMMENT '备注名',
    `userid` VARCHAR(50) NOT NULL COMMENT '美团userId',
    `token` TEXT NOT NULL COMMENT '美团token',
    `url` TEXT COMMENT '完整URL',
    `csecuuid` VARCHAR(100) COMMENT '抓包获取',
    `open_id` VARCHAR(100) COMMENT 'openId',
    `open_id_cipher` VARCHAR(255) COMMENT 'openIdCipher',
    `status` ENUM('normal', 'invalid', 'unchecked') DEFAULT 'unchecked',
    `last_check_time` DATETIME COMMENT '最后检测时间',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_userid (userid),
    INDEX idx_user (user_id)
);

-- 订单表
CREATE TABLE `orders` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `account_id` INT NOT NULL COMMENT '所属账号',
    `order_id` VARCHAR(50) NOT NULL COMMENT '订单号',
    `order_view_id` VARCHAR(50) COMMENT '推广单号',
    `order_amount` DECIMAL(10,2) COMMENT '订单金额',
    `commission_fee` DECIMAL(10,2) COMMENT '佣金',
    `total_coupon_num` INT COMMENT '子订单数',
    `order_status` INT COMMENT '订单状态(3已退款/4未核销/5已核销)',
    `order_pay_time` DATETIME COMMENT '支付时间',
    `city_name` VARCHAR(50) COMMENT '下单城市',
    `consume_city_name` VARCHAR(50) COMMENT '消费城市',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_account_order (account_id, order_id),
    INDEX idx_order_id (order_id),
    INDEX idx_pay_time (order_pay_time)
);

-- 券码表
CREATE TABLE `coupons` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `order_id` INT NOT NULL COMMENT '关联订单',
    `account_id` INT NOT NULL,
    `coupon_code` VARCHAR(100) COMMENT '券码',
    `coupon_status` INT COMMENT '券码状态',
    `gift_id` VARCHAR(50) COMMENT '礼物号',
    `query_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `raw_data` JSON COMMENT '原始数据',
    INDEX idx_coupon_code (coupon_code),
    INDEX idx_gift_id (gift_id)
);

-- 系统配置表
CREATE TABLE `system_config` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `config_key` VARCHAR(50) UNIQUE NOT NULL,
    `config_value` TEXT,
    `config_type` VARCHAR(20) DEFAULT 'string' COMMENT '类型: string/number/boolean/json',
    `category` VARCHAR(30) COMMENT '分类: scan/proxy/api/log',
    `is_public` BOOLEAN DEFAULT FALSE COMMENT '是否对普通用户可见',
    `description` VARCHAR(255),
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 登录日志表
CREATE TABLE `login_logs` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `user_id` INT COMMENT '用户ID',
    `username` VARCHAR(50) COMMENT '用户名',
    `ip_address` VARCHAR(50) COMMENT 'IP地址',
    `user_agent` VARCHAR(255) COMMENT '用户代理',
    `login_status` VARCHAR(20) COMMENT '登录状态: success/failed',
    `fail_reason` VARCHAR(255) COMMENT '失败原因',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_created (created_at)
);

-- 操作日志表
CREATE TABLE `operation_logs` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `user_id` INT,
    `action` VARCHAR(50) COMMENT '操作类型',
    `target_type` VARCHAR(20) COMMENT '目标类型',
    `target_id` INT,
    `details` TEXT,
    `ip_address` VARCHAR(50),
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_created (created_at)
);
```

---

## 4. 前端开发方案

### 4.1 项目结构

```
mt-coupon-system/
├── electron/
│   ├── main.js              # Electron 主进程
│   ├── preload.js           # 预加载脚本
│   ├── proxy/               # 代理抓包模块
│   │   ├── proxyService.js
│   │   └── certManager.js
│   └── ipc/                 # IPC 处理器
├── src/
│   ├── main.jsx             # React 入口
│   ├── App.jsx              # 根组件
│   ├── api/                 # API 请求
│   │   └── index.js
│   ├── components/          # 通用组件
│   │   ├── Layout/
│   │   ├── Sidebar.jsx
│   │   └── ToastHost.jsx
│   ├── pages/               # 页面组件
│   │   ├── AccountPage.jsx   # 账号管理
│   │   ├── OrderListPage.jsx # 订单列表
│   │   ├── CouponQueryPage.jsx # 券码查询
│   │   ├── LogPage.jsx       # 运行日志
│   │   ├── SettingsPage.jsx # 系统设置
│   │   ├── UserPage.jsx      # 用户管理
│   │   └── LoginPage.jsx    # 登录页
│   ├── stores/              # 状态管理
│   │   └── authStore.js
│   └── styles/
│       └── global.css
├── package.json
└── vite.config.js
```

### 4.2 UI 设计（复刻参考项目）

参考"功能参考项目"的 UI 风格：

1. **整体风格**：TailwindCSS + Ant Design 组件
2. **配色方案**：
   - 主色：橙色 (#f97316) - 与美团品牌呼应
   - 背景：灰白色 (#f3f4f6)
   - 卡片：白色带阴影
3. **组件风格**：
   - 按钮：圆角卡片式
   - 表格：条纹+悬浮高亮
   - 图标：lucide-react

### 4.3 页面详细设计

#### 4.3.1 账号管理页面（完整复刻）

```jsx
// 功能完整复刻 Reference Project
// 1. 备注名输入框
// 2. 完整URL输入框
// 3. 添加/更新按钮
// 4. 抓取Token按钮（启动代理抓包）
// 5. 导入/导出按钮
// 6. 检查全部按钮
// 7. 重置证书按钮
// 8. 搜索功能
// 9. 账号列表表格（支持多选、右键菜单）
// 10. 修改账号弹窗
```

**数据交互变化**：
- 原来：`window.electronAPI.accountsSave(accounts)` 保存到本地 JSON
- 改为：`POST /api/accounts` 保存到服务端 MySQL

#### 4.3.2 订单列表页面（UI复刻，功能简化）

```jsx
// UI 完整复刻 Reference Project
// 1. 账号选择下拉框
// 2. 订单状态筛选（数据库筛选）
// 3. 时间范围选择（数据库筛选）
// 4. 刷新按钮（从数据库拉取）
// 5. 导出Excel按钮

// 功能说明：
// - 订单数据从本地数据库拉取（由定时扫描服务落库）
// - 不调用美团接口获取最新（与参考项目不同）
// - 筛选功能基于数据库查询实现
// - 支持分页展示
```

**API 接口：**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/orders | 获取订单列表（支持账号、状态、时间筛选） |

#### 4.3.3 券码查询页面

```jsx
// 功能设计
// 1. 输入框：券码（支持批量换行）
// 2. 查询按钮
// 3. 进度条
// 4. 结果表格：
//    - 券码 | 订单号 | 礼物号 | userid | 状态 | 更新时间
```

#### 4.3.4 运行日志页面

```jsx
// 功能设计
// 1. 日志级别筛选（INFO/WARNING/ERROR/DEBUG）
// 2. 时间范围选择
// 3. 关键词搜索
// 4. 日志列表（实时更新）
// 5. 导出日志按钮
// 6. 清空日志按钮
```

#### 4.3.5 系统设置页面（仅管理员）

```jsx
// 功能设计
// 1. 定时扫描配置
//    - 扫描间隔（分钟）
//    - 每次扫描账号数
//    - 请求间隔（毫秒）
// 2. 代理配置
//    - 抓包端口
//    - 证书路径
// 3. API 配置
//    - 美团接口地址
//    - 重试次数
// 4. 日志配置
//    - 日志保留天数
//    - 日志级别
// 5. API Key 管理
//    - 创建/删除对外 API 密钥
```

**权限控制：**
- 页面仅 `admin` 角色可见
- 普通用户访问返回 403 Forbidden
- 前端路由守卫 + 后端接口鉴权双重保护

#### 4.3.6 用户管理页面（仅管理员）

```jsx
// 功能设计
// 1. 用户列表表格
//    - ID | 用户名 | 角色 | 状态 | 创建时间 | 操作
// 2. 新增用户按钮
// 3. 编辑用户按钮
// 4. 删除用户按钮
// 5. 重置密码功能
// 6. 启用/禁用用户
```

### 4.4 关键技术实现

#### 4.4.1 抓包功能（复刻实现）

```javascript
// electron/proxy/proxyService.js
// 完整复刻 Reference Project 的代理抓包逻辑
// 1. 启动本地 HTTP 代理服务器
// 2. 拦截美团小程序网络请求
// 3. 解析 token、userid、csecuuid、openId 等参数
// 4. 通过 IPC 返回给渲染进程
```

#### 4.4.2 状态管理

```javascript
// 使用 React Context + useReducer
// api/index.js 封装所有 API 请求
```

---

## 5. 后端开发方案

### 5.1 项目结构

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI 应用入口
│   ├── config.py            # 配置管理
│   ├── database.py          # 数据库连接
│   ├── models/              # SQLAlchemy 模型
│   │   ├── __init__.py
│   │   ├── user.py
│   │   ├── account.py
│   │   ├── order.py
│   │   ├── coupon.py
│   │   └── log.py
│   ├── schemas/             # Pydantic 模型
│   │   ├── __init__.py
│   │   ├── user.py
│   │   ├── account.py
│   │   ├── order.py
│   │   └── coupon.py
│   ├── routers/             # API 路由
│   │   ├── __init__.py
│   │   ├── auth.py
│   │   ├── accounts.py
│   │   ├── orders.py
│   │   ├── coupons.py
│   │   ├── logs.py
│   │   ├── settings.py
│   │   └── users.py
│   ├── services/            # 业务逻辑
│   │   ├── __init__.py
│   │   ├── meituan/
│   │   │   ├── __init__.py
│   │   │   ├── api.py          # 美团API（复刻）
│   │   │   ├── signature.py    # 签名（复刻 mtgsig.js）
│   │   │   └── scanner.py      # 定时扫描服务
│   │   ├── auth_service.py
│   │   └── log_service.py
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── logger.py
│   │   └── validators.py
│   └── deps.py              # 依赖注入
├── requirements.txt
└── .env
```

### 5.2 API 接口设计

#### 5.2.1 认证接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/login | 用户登录 |
| POST | /api/auth/logout | 用户登出 |
| GET | /api/auth/me | 获取当前用户 |

#### 5.2.2 账号管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/accounts | 获取账号列表 |
| POST | /api/accounts | 添加账号 |
| PUT | /api/accounts/{id} | 更新账号 |
| DELETE | /api/accounts/{id} | 删除账号 |
| POST | /api/accounts/check | 批量检查账号状态 |
| POST | /api/accounts/import | 导入账号 |
| POST | /api/accounts/export | 导出账号 |

#### 5.2.3 订单接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/orders | 获取订单列表 |
| GET | /api/orders/{id} | 获取订单详情 |
| POST | /api/orders/sync | 同步订单（调用美团接口） |
| DELETE | /api/orders/{id} | 删除订单 |

#### 5.2.4 券码接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/coupons | 获取券码列表 |
| POST | /api/coupons/query | 券码查询 |
| GET | /api/coupons/{id} | 券码详情 |

#### 5.2.5 日志接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/logs | 获取日志列表 |
| DELETE | /api/logs | 清空日志 |
| GET | /api/logs/export | 导出日志 |

#### 5.2.6 系统设置接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/settings | 获取配置 |
| PUT | /api/settings | 更新配置 |

#### 5.2.7 用户管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/users | 获取用户列表 |
| POST | /api/users | 创建用户 |
| PUT | /api/users/{id} | 更新用户 |
| DELETE | /api/users/{id} | 删除用户 |
| POST | /api/users/{id}/reset-password | 重置密码 |

#### 5.2.8 对外API（可扩展）

**API Key 认证机制：**

```sql
-- API 密钥表
CREATE TABLE `api_keys` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `key` VARCHAR(64) UNIQUE NOT NULL,
    `secret` VARCHAR(128) NOT NULL,
    `name` VARCHAR(50) COMMENT '密钥名称/用途',
    `rate_limit` INT DEFAULT 100 COMMENT '每分钟请求限制',
    `is_active` BOOLEAN DEFAULT TRUE,
    `last_used_at` DATETIME,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `expired_at` DATETIME COMMENT '过期时间',
    INDEX idx_key (key)
);
```

**认证方式：**
- Header 认证：`X-API-Key: <key>` + `X-API-Secret: <secret>`
- 或 Query 参数：`?api_key=<key>&api_secret=<secret>`

**限流策略：**
- 基于 API Key 维度限流
- 默认每分钟 100 次请求（可配置）
- 超出限制返回 429 状态码

**接口设计：**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/coupons/{code} | 券码查询（需API Key） |
| GET | /api/v1/accounts/{userid}/orders | 订单查询（需API Key） |
| GET | /api/v1/accounts/{userid}/stats | 账号统计数据（需API Key） |
| POST | /api/v1/keys | 创建 API Key（仅管理员） |
| GET | /api/v1/keys | 获取 API Key 列表（仅管理员） |
| DELETE | /api/v1/keys/{id} | 删除 API Key（仅管理员） |

### 5.3 定时扫描服务

```python
# app/services/meituan/scanner.py

class CouponScanner:
    """定时扫描服务"""

    def __init__(self):
        self.retry_times = 3
        self.retry_delay = 5  # 秒
        self.request_interval = 0.7  # 请求间隔（秒）

    async def scan_account(self, account):
        """扫描单个账号的订单"""
        # 1. 调用美团接口获取订单列表
        # 2. 过滤未落库的订单
        # 3. 对每个订单调用券码查询接口
        # 4. 保存到数据库

    async def scan_all_valid_accounts(self):
        """扫描所有有效账号"""
        # 1. 获取所有状态为 normal 的账号
        # 2. 逐个调用 scan_account
        # 3. 记录扫描结果和错误

    def setup_scheduler(self):
        """配置定时任务"""
        # 每 N 分钟执行一次扫描
        # 支持手动触发扫描
```

**重试机制设计**：

```python
async def with_retry(coro, max_retries=3, delay=5):
    """带重试的异步执行"""
    for attempt in range(max_retries):
        try:
            return await coro
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(delay * (attempt + 1))
```

### 5.4 美团API复刻

```python
# app/services/meituan/api.py

# 复制 Reference Project 的实现：
# 1. meituanAPI.js -> api.py
# 2. mtgsig.js -> signature.py (使用 pyexecjs 执行 JS)
# 3. mtgsigClient.py -> client.py
```

### 5.5 日志系统

```python
# app/utils/logger.py

import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime

class LogService:
    """日志服务"""

    def __init__(self):
        self.logger = logging.getLogger('mt-coupon')
        # 配置文件轮转
        # 控制台输出
        # 数据库记录

    def log_operation(self, user_id, action, details, target_type=None, target_id=None):
        """记录操作日志到数据库"""
        # 记录到 operation_logs 表
        pass

    def log_login(self, user_id, username, ip_address, status, fail_reason=None):
        """记录登录日志到数据库"""
        # 记录到 login_logs 表
        pass

    def log_scan(self, account_id, result):
        """记录扫描结果"""
        # 记录扫描的订单数、成功数、失败数
        pass

    def log_error(self, error, context, details=None):
        """记录错误详情"""
        # 记录堆栈信息和上下文
        pass
```

**日志记录范围：**

| 类型 | 记录内容 | 存储位置 |
|------|----------|----------|
| 操作日志 | 用户 CRUD、账号管理、券码查询等操作 | operation_logs 表 |
| 登录日志 | 登录成功/失败、时间、IP | login_logs 表 |
| 扫描日志 | 定时扫描结果、订单数、券码状态 | operation_logs 表 |
| 错误日志 | 异常堆栈、上下文 | 文件 + operation_logs |
| 访问日志 | API 请求、响应状态码 | 文件 |

**日志级别**：
- DEBUG：详细调试信息（如 SQL 语句、请求参数）
- INFO：一般操作信息（如用户登录、订单查询）
- WARNING：警告信息（如 token 即将过期、扫描重试）
- ERROR：错误信息（如接口调用失败、数据异常）
- CRITICAL：严重错误（如服务崩溃、数据库断开）

**日志文件策略：**
- 按日期分割：`logs/mt-coupon-2026-03-29.log`
- 单文件最大 10MB，保留 30 天
- 错误日志单独保存：`logs/error-2026-03-29.log`

---

## 6. 开发计划

### 6.1 第一阶段：基础架构搭建

| 任务 | 描述 | 预估工时 |
|------|------|----------|
| 1.1 | 项目初始化（前后端） | 1天 |
| 1.2 | 数据库设计和实现 | 1天 |
| 1.3 | 后端基础框架（FastAPI） | 2天 |
| 1.4 | 前端基础框架（Electron+React） | 2天 |

### 6.2 第二阶段：核心功能开发

| 任务 | 描述 | 预估工时 |
|------|------|----------|
| 2.1 | 用户认证系统 | 2天 |
| 2.2 | 账号管理（完整复刻） | 3天 |
| 2.3 | 抓包功能复刻 | 3天 |
| 2.4 | 订单列表（UI复刻） | 2天 |

### 6.3 第三阶段：业务功能开发

| 任务 | 描述 | 预估工时 |
|------|------|----------|
| 3.1 | 券码查询功能 | 2天 |
| 3.2 | 定时扫描服务 | 3天 |
| 3.3 | 运行日志系统 | 2天 |
| 3.4 | 系统设置 | 1天 |

### 6.4 第四阶段：用户和管理功能

| 任务 | 描述 | 预估工时 |
|------|------|----------|
| 4.1 | 用户管理CRUD | 2天 |
| 4.2 | 对外API开发 | 2天 |
| 4.3 | 测试和优化 | 3天 |

**总预估工时**：约 28 天

---

## 7. 关键文件对照

### 7.1 需要复刻的文件

| 原项目文件 | 新项目位置 |
|------------|------------|
| `mtgsig.js` | `backend/app/services/meituan/signature.py` |
| `meituanAPI.js` | `backend/app/services/meituan/api.py` |
| `mtgsigClient.py` | `backend/app/services/meituan/client.py` |
| `proxyService.js` | `electron/proxy/proxyService.js` |
| `AuthClient.js` | `backend/app/services/auth_service.py` |
| `AccountPage.jsx` | `src/pages/AccountPage.jsx` |
| `RebateQueryPage.jsx` | `src/pages/CouponQueryPage.jsx` |

### 7.2 需要新建的文件

| 文件 | 说明 |
|------|------|
| `backend/app/main.py` | FastAPI 应用入口 |
| `backend/app/models/*.py` | 数据库模型 |
| `backend/app/routers/*.py` | API 路由 |
| `src/pages/OrderListPage.jsx` | 订单列表页 |
| `src/pages/LogPage.jsx` | 日志页 |
| `src/pages/SettingsPage.jsx` | 设置页 |
| `src/pages/UserPage.jsx` | 用户管理页 |

---

## 8. 部署方案

### 8.1 开发环境

```bash
# 前端
cd frontend && npm install && npm run dev

# 后端
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload
```

### 8.2 生产环境

```bash
# 打包前端
cd frontend && npm run build

# 打包 Electron
cd frontend && npm run package:win

# 部署后端
# 使用 Gunicorn + Nginx 部署
```

---

## 9. 验证方案

### 9.1 功能测试

1. **账号管理**：添加、删除、编辑、导入导出、抓取Token
2. **订单列表**：筛选、导出、刷新
3. **券码查询**：单条、批量查询
4. **定时扫描**：手动触发、定时执行
5. **用户管理**：CRUD、权限控制
6. **系统设置**：配置保存、权限验证

### 9.2 压力测试

- 模拟 100+ 账号同时扫描
- 批量查询 1000+ 券码
- 高并发 API 请求

### 9.3 异常处理测试

- 网络超时重试
- 数据库连接失败
- 美团接口限流处理

---

## 10. 注意事项

1. **安全性**：
   - Token 等敏感信息加密存储
   - API 接口加入鉴权和限流
   - 抓包证书妥善管理

2. **稳定性**：
   - 所有外部调用加入重试机制
   - 定时任务加入超时控制
   - 完善的异常捕获和日志记录

3. **扩展性**：
   - 预留美团其他业务线接口
   - 对外 API 版本化管理

---

*文档版本：v1.0*
*创建日期：2026-03-29*
