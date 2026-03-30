# WinsTech MT Coupon System 部署文档

## 项目信息

| 项目 | 地址 |
|------|------|
| GitHub | https://github.com/FBI888888/WinsTechMTCouponSystem.git |
| 后端API服务 | http://winscoupons.winstech.top |
| 数据库 | winssql.winstech.top:3306 |

## 系统架构

```
┌─────────────────┐         ┌──────────────────┐
│  Electron桌面端  │ ──────> │   后端API服务    │
│  (用户安装)      │  HTTP   │  (服务器部署)    │
└─────────────────┘         └──────────────────┘
                                    │
                                    ▼
                            ┌──────────────┐
                            │   MySQL数据库 │
                            └──────────────┘
```

- **后端**：部署到服务器，提供API接口
- **前端**：打包为Electron桌面应用，分发给用户安装
- **数据库**：MySQL数据库服务

---

## 一、后端部署

### 1.1 环境要求

- Python 3.10+
- Node.js 18+ (用于签名脚本)
- MySQL 8.0+

### 1.2 克隆代码

```bash
# 创建项目目录
mkdir -p /www/wwwroot/winscoupons.winstech.top
cd /www/wwwroot/winscoupons.winstech.top

# 克隆代码
git clone https://github.com/FBI888888/WinsTechMTCouponSystem.git .

cd WinsTechMTCouponSystem

# 进入后端目录
cd backend
```

### 1.3 创建虚拟环境

```bash
cd /www/wwwroot/winscoupons.winstech.top/backend

# 创建虚拟环境
python3 -m venv venv

# 激活虚拟环境
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

### 1.4 配置环境变量

```bash
# 复制生产环境配置
cp .env.production .env

# 编辑配置文件
nano .env
```

**重要：修改以下配置项：**
```ini
# 数据库密码
DB_PASSWORD=你的数据库密码

# JWT密钥（生成随机字符串）
SECRET_KEY=使用随机生成的密钥

# Node.js路径（根据实际安装路径）
NODE_PATH=/www/server/nodejs/v20.10.0/bin/node
```

### 1.5 初始化数据库

```bash
# 激活虚拟环境
source venv/bin/activate

# 初始化数据库（创建表和默认管理员）
python init_db.py
```

**重要：初始化完成后会创建默认管理员账户**
- 用户名: `admin`
- 密码: `admin123`
- 请及时修改默认密码！

### 1.6 诊断排查（如有问题）

如果登录失败或出现500错误，运行诊断脚本：

```bash
# 激活虚拟环境
source venv/bin/activate

# 运行诊断脚本
python diagnose.py
```

诊断脚本会检查：
- 数据库连接是否正常
- 数据表是否存在
- 管理员用户是否存在
- 登录流程是否正常

**常见问题排查**：

1. **数据库连接失败**
   ```bash
   # 检查数据库服务
   systemctl status mysql

   # 测试数据库连接
   mysql -h winssql.winstech.top -u root -p
   ```

2. **表不存在**
   ```bash
   # 重新初始化数据库
   python init_db.py
   ```

3. **管理员用户不存在**
   ```bash
   # 重新创建管理员
   python init_db.py
   ```

### 1.6 宝塔面板部署后端

#### 方式一：使用Python项目管理器（推荐）

1. **安装Python项目管理器**
   - 宝塔软件商店 → 搜索 "Python项目管理器" → 安装

2. **创建项目**
   - 点击 "Python项目管理器" → "添加项目"
   - 项目名称: `mtcoupon`
   - 项目路径: `/www/wwwroot/winscoupons.winstech.top/backend`
   - Python版本: 3.10+
   - 框架: `FastAPI`
   - 启动方式: `gunicorn`
   - 启动文件: `app.main:app`
   - 端口: `8000`

3. **配置环境变量**
   - 项目设置 → 环境变量 → 添加：
   ```
   DB_HOST=winssql.winstech.top
   DB_PASSWORD=你的数据库密码
   SECRET_KEY=你的JWT密钥
   NODE_PATH=/www/server/nodejs/v20.10.0/bin/node
   ```

4. **启动项目**
   - 点击 "启动" 按钮

#### 方式二：使用Systemd服务

创建服务文件 `/etc/systemd/system/mtcoupon.service`:

```ini
[Unit]
Description=MT Coupon System Backend
After=network.target

[Service]
Type=notify
User=www
Group=www
WorkingDirectory=/www/wwwroot/winscoupons.winstech.top/backend
Environment="PATH=/www/wwwroot/winscoupons.winstech.top/backend/venv/bin"
ExecStart=/www/wwwroot/winscoupons.winstech.top/backend/venv/bin/gunicorn -c gunicorn.conf.py app.main:app
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启动服务：
```bash
systemctl daemon-reload
systemctl start mtcoupon
systemctl enable mtcoupon
systemctl status mtcoupon
```

### 1.7 开放API端口

后端API运行在8000端口，需要确保外网可以访问：

#### 方式一：直接开放端口（简单）

在宝塔面板：
1. 安全 → 防火墙
2. 添加规则：端口 `8000`，备注 `MT Coupon API`
3. 如果使用云服务器，还需在云服务商控制台开放8000端口

#### 方式二：Nginx反向代理（推荐）

在宝塔面板创建网站并配置反向代理：

1. **创建网站**
   - 网站 → 添加站点
   - 域名: `winscoupons.winstech.top`
   - 根目录: 任意（不会用到）
   - PHP版本: 纯静态

2. **配置反向代理**
   - 网站设置 → 反向代理 → 添加反向代理
   - 代理名称: `api`
   - 目标URL: `http://127.0.0.1:8000`
   - 发送域名: `$host`

这样前端访问 `http://winscoupons.winstech.top/api/*` 会转发到后端API。

### 1.8 验证后端部署

部署完成后，验证后端API是否正常：

```bash
# 检查服务状态
curl http://127.0.0.1:8000/api/auth/me

# 或在浏览器访问
# http://winscoupons.winstech.top/api/auth/me
```

如果返回 `{"detail":"Not authenticated"}` 表示API服务正常运行。

---

## 二、Electron桌面应用打包

前端是Electron桌面应用，打包为安装包分发给用户。

### 2.1 环境准备

确保本地开发环境已安装：
- Node.js 18+
- npm 或 yarn

### 2.2 配置API地址

编辑 `frontend/.env.production`：

```ini
# 生产环境API地址
VITE_API_BASE_URL=http://winscoupons.winstech.top
```

### 2.3 打包命令

```bash
# 克隆代码到本地
git clone https://github.com/FBI888888/WinsTechMTCouponSystem.git
cd WinsTechMTCouponSystem/frontend

# 安装依赖
npm install

# 打包Electron应用（Windows）
npm run electron:build

# 打包完成后，安装包位于：
# Windows: dist-electron/MT Coupon System Setup 1.0.0.exe
# macOS: dist-electron/MT Coupon System-1.0.0.dmg
# Linux: dist-electron/MT Coupon System-1.0.0.AppImage
```

### 2.4 分发方式

打包完成后，将安装包上传到文件服务器或通过以下方式分发：

1. **直接分发**：将安装包发送给用户
2. **网盘下载**：上传到百度网盘、阿里云盘等
3. **自有服务器**：上传到服务器提供下载链接

### 2.5 用户安装

用户下载安装包后：
- **Windows**：双击 `.exe` 安装包，按提示安装
- **macOS**：双击 `.dmg` 文件，拖拽到 Applications
- **Linux**：双击 `.AppImage` 文件运行，或安装 `.deb`/`.rpm` 包

### 2.6 开发测试

```bash
# 开发模式运行
npm run electron:dev

# 或先启动Vite，再启动Electron
npm run dev
npm run electron:start
```

---

## 三、更新部署

### 3.1 后端更新

#### 使用Python项目管理器
```bash
# SSH 登录服务器
ssh root@winscoupons.winstech.top

# 进入项目目录
cd /www/wwwroot/winscoupons.winstech.top

# 拉取最新代码
git pull

# 进入后端目录
cd backend

# 激活虚拟环境
source venv/bin/activate

# 更新依赖（如有新增）
pip install -r requirements.txt

# 在宝塔面板中：
# Python项目管理器 → mtcoupon → 重启
```

#### 使用Systemd服务
```bash
# SSH 登录服务器
ssh root@winscoupons.winstech.top

# 进入项目目录
cd /www/wwwroot/winscoupons.winstech.top

# 拉取最新代码
git pull

# 进入后端目录
cd backend

# 激活虚拟环境
source venv/bin/activate

# 更新依赖（如有新增）
pip install -r requirements.txt

# 重启服务
systemctl restart mtcoupon

# 查看日志
journalctl -u mtcoupon -f
```

### 3.2 Electron应用更新

当有新版本发布时：

```bash
# 本地拉取最新代码
git pull

# 进入前端目录
cd frontend

# 安装新依赖（如有）
npm install

# 重新打包
npm run electron:build

# 将新的安装包分发给用户
# dist-electron/MT Coupon System Setup 1.0.0.exe
```

用户需要：
1. 下载新版本安装包
2. 卸载旧版本（可选，部分情况可覆盖安装）
3. 安装新版本

### 3.3 版本号管理

修改 `frontend/package.json` 中的版本号：

```json
{
  "name": "mt-coupon-frontend",
  "version": "1.0.1",  // 更新版本号
  ...
}
```

打包后的安装包会自动带上版本号：`MT Coupon System Setup 1.0.1.exe`

### 3.4 一键更新脚本

使用项目提供的部署脚本（适用于Systemd方式）：

```bash
cd /www/wwwroot/winscoupons.winstech.top/backend
bash deploy.sh
```

> **提示**：如果使用宝塔Python项目管理器，直接在面板中点击"重启"按钮即可。

---

## 四、常见问题

### 4.1 查看后端日志

```bash
# 实时日志
journalctl -u mtcoupon -f

# 最近100行
journalctl -u mtcoupon -n 100
```

### 4.2 重启服务

```bash
systemctl restart mtcoupon
```

### 4.3 检查端口占用

```bash
netstat -tlnp | grep 8000
```

### 4.4 数据库连接失败

1. 检查数据库服务是否运行
2. 检查防火墙是否开放3306端口
3. 检查数据库用户权限

```sql
-- 在数据库服务器上执行
GRANT ALL PRIVILEGES ON mt_coupon.* TO 'root'@'%' IDENTIFIED BY 'your_password';
FLUSH PRIVILEGES;
```

### 4.5 Node.js 路径问题

```bash
# 查找Node.js路径
which node

# 更新 .env 中的 NODE_PATH
```

### 4.6 Electron应用无法连接后端

检查以下项目：

1. **检查后端API是否正常**
   ```bash
   curl http://winscoupons.winstech.top/api/auth/me
   ```

2. **检查防火墙是否开放端口**
   - 宝塔面板 → 安全 → 确保8000端口已开放
   - 云服务器控制台 → 安全组 → 开放8000端口

3. **检查前端配置**
   - 确认 `frontend/.env.production` 中的API地址正确
   - 重新打包应用

### 4.7 Electron打包失败

常见原因：

1. **网络问题**：下载Electron二进制文件失败
   ```bash
   # 设置国内镜像
   npm config set electron_mirror https://npmmirror.com/mirrors/electron/
   npm run electron:build
   ```

2. **依赖问题**
   ```bash
   # 清除依赖重新安装
   rm -rf node_modules
   npm install
   ```

3. **Windows打包需要管理员权限**
   - 右键以管理员身份运行PowerShell
   - 再执行打包命令

---

## 五、数据库配置

### 5.1 创建数据库

```sql
CREATE DATABASE mt_coupon CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 5.2 允许远程连接

```sql
-- 创建用户并授权
CREATE USER 'mtcoupon'@'%' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON mt_coupon.* TO 'mtcoupon'@'%';
FLUSH PRIVILEGES;
```

### 5.3 防火墙配置

在数据库服务器宝塔面板：
1. 安全 -> 防火墙
2. 添加规则：端口 3306，来源 IP 填写后端服务器 IP (140.210.15.149)

---

## 六、目录结构

```
WinsTechMTCouponSystem/
├── .git/                      # Git仓库
├── backend/                   # 后端应用（部署到服务器）
│   ├── app/                   # 应用代码
│   ├── venv/                  # Python虚拟环境（服务器上）
│   ├── .env                   # 环境配置（服务器上）
│   ├── .env.production        # 生产环境配置模板
│   ├── requirements.txt       # Python依赖
│   ├── gunicorn.conf.py       # Gunicorn配置
│   ├── deploy.sh              # 部署脚本
│   └── init_db.py             # 数据库初始化
├── frontend/                  # 前端Electron应用（本地打包）
│   ├── electron/              # Electron主进程
│   ├── src/                   # React源码
│   ├── dist/                  # Vite构建产物
│   ├── dist-electron/         # Electron打包输出
│   ├── .env.development       # 开发环境配置
│   └── .env.production       # 生产环境配置
├── DEPLOY.md                  # 部署文档
└── README.md                  # 项目说明
```

---

## 七、安全建议

1. **修改默认管理员密码**：首次登录后立即修改
2. **更换JWT密钥**：使用随机生成的强密钥
3. **启用Token加密**：生产环境建议开启 `TOKEN_ENCRYPTION_ENABLED=true`
4. **配置防火墙**：只开放必要端口
5. **定期备份数据库**

---

## 八、联系方式

如有问题，请联系技术支持。
