# WinsTech MT Coupon System

美团券码管理系统 - Electron桌面应用 + FastAPI后端

## 项目地址

- **GitHub**: https://github.com/FBI888888/WinsTechMTCouponSystem.git
- **后端API**: http://winscoupons.winstech.top

## 系统架构

```
┌─────────────────┐         ┌──────────────────┐
│  Electron桌面端  │ ──────> │   后端API服务    │
│  (用户安装)      │  HTTP   │  (服务器部署)    │
└─────────────────┘         └──────────────────┘
```

## 技术栈

### 后端
- Python 3.10+
- FastAPI
- SQLAlchemy
- MySQL 8.0

### 前端
- Electron 28
- React 18
- Vite 5
- TailwindCSS

## 功能模块

- **账号管理**: 管理美团账号，支持Token抓取和状态检查
- **订单列表**: 同步和管理订单，支持券码扫描
- **券码查询**: 批量查询券码状态
- **订单查询**: 通过订单号查询券码信息
- **运行日志**: 系统操作日志查看
- **系统设置**: 定时任务和系统配置

## 快速开始

### 后端启动

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate  # Windows
pip install -r requirements.txt

# 初始化数据库（创建表和默认管理员）
python init_db.py

# 启动服务
uvicorn app.main:app --reload
```

**默认管理员账户**：
- 用户名: `admin`
- 密码: `admin123`

### 问题诊断

如果遇到登录失败或其他问题，运行诊断脚本：

```bash
cd backend
source venv/bin/activate
python diagnose.py
```

详见：[TROUBLESHOOTING-LOGIN.md](./TROUBLESHOOTING-LOGIN.md)

### 前端启动

```bash
cd frontend
npm install
npm run electron:dev
```

## 打包部署

### 后端部署到服务器

详见 [DEPLOY.md](./DEPLOY.md)

### Electron应用打包

```bash
cd frontend
npm run electron:build

# 打包产物位于 dist-electron/
# Windows: MT Coupon System Setup 1.2.0.exe
```

## 更新流程

### 后端更新
```bash
cd /www/wwwroot/winscoupons.winstech.top
git pull
cd backend
source venv/bin/activate
pip install -r requirements.txt
systemctl restart mtcoupon
```

### Electron应用更新
```bash
git pull
cd frontend
npm install
npm run electron:build
# 分发新的安装包给用户
```

## 许可证

MIT License
