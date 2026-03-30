# WinsTech MT Coupon System 部署文档

## 服务器信息

| 服务 | 域名 | 说明 |
|------|------|------|
| 后端服务 | winscoupons.winstech.top | HTTP (无HTTPS) |
| 数据库 | winssql.winstech.top | MySQL 3306 |

---

## 一、后端部署

### 1.1 环境要求

- Python 3.10+
- Node.js 18+ (用于签名脚本)
- MySQL 8.0+

### 1.2 宝塔面板安装 Python

```bash
# 在宝塔软件商店安装 Python项目管理器 2.0

# 或手动安装
cd /www/server
wget https://www.python.org/ftp/python/3.10.13/Python-3.10.13.tgz
tar -xzf Python-3.10.13.tgz
cd Python-3.10.13
./configure --prefix=/www/server/python3
make && make install
```

### 1.3 上传代码

```bash
# 创建项目目录
mkdir -p /www/wwwroot/winscoupons.winstech.top
cd /www/wwwroot/winscoupons.winstech.top

# 上传 backend 文件夹内容到此目录
```

### 1.4 创建虚拟环境

```bash
cd /www/wwwroot/winscoupons.winstech.top

# 创建虚拟环境
python3 -m venv venv

# 激活虚拟环境
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

### 1.5 配置环境变量

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

### 1.6 初始化数据库

```bash
# 激活虚拟环境
source venv/bin/activate

# 初始化数据库
python init_db.py
```

### 1.7 配置 Gunicorn

创建 `gunicorn.conf.py`:
```python
# gunicorn.conf.py
bind = "127.0.0.1:8000"
workers = 4
worker_class = "uvicorn.workers.UvicornWorker"
timeout = 120
keepalive = 5
```

### 1.8 配置 Systemd 服务

创建服务文件 `/etc/systemd/system/mtcoupon.service`:

```ini
[Unit]
Description=MT Coupon System Backend
After=network.target

[Service]
Type=notify
User=www
Group=www
WorkingDirectory=/www/wwwroot/winscoupons.winstech.top
Environment="PATH=/www/wwwroot/winscoupons.winstech.top/venv/bin"
ExecStart=/www/wwwroot/winscoupons.winstech.top/venv/bin/gunicorn -c gunicorn.conf.py app.main:app
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

### 1.9 配置 Nginx 反向代理

在宝塔面板创建网站 `winscoupons.winstech.top`，然后修改 Nginx 配置：

```nginx
server {
    listen 80;
    server_name winscoupons.winstech.top;

    # 后端API代理
    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # 前端静态文件
    location / {
        root /www/wwwroot/winscoupons.winstech.top/frontend;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # 访问日志
    access_log /www/wwwlogs/winscoupons.access.log;
    error_log /www/wwwlogs/winscoupons.error.log;
}
```

---

## 二、前端部署

### 2.1 本地构建

```bash
# 进入前端目录
cd frontend

# 安装依赖
npm install

# 构建生产版本
npm run build
```

### 2.2 上传构建产物

将 `frontend/dist` 目录下的所有文件上传到服务器：

```bash
# 在服务器上创建前端目录
mkdir -p /www/wwwroot/winscoupons.winstech.top/frontend

# 上传 dist/* 到该目录
```

### 2.3 前端配置说明

前端通过 `.env.production` 配置API地址：

```ini
# frontend/.env.production
VITE_API_BASE_URL=http://winscoupons.winstech.top
```

---

## 三、更新部署

### 3.1 后端更新

```bash
# SSH 登录服务器
ssh root@winscoupons.winstech.top

# 进入项目目录
cd /www/wwwroot/winscoupons.winstech.top

# 拉取最新代码（如果使用Git）
git pull

# 或上传新的代码文件

# 激活虚拟环境
source venv/bin/activate

# 更新依赖（如有新增）
pip install -r requirements.txt

# 重启服务
systemctl restart mtcoupon

# 查看日志
journalctl -u mtcoupon -f
```

### 3.2 前端更新

```bash
# 本地构建
cd frontend
npm run build

# 上传 dist/* 到服务器
# /www/wwwroot/winscoupons.winstech.top/frontend/

# 清除浏览器缓存后刷新即可
```

### 3.3 一键更新脚本

创建 `/www/wwwroot/winscoupons.winstech.top/update.sh`:

```bash
#!/bin/bash

echo "=== 更新 MT Coupon System ==="

cd /www/wwwroot/winscoupons.winstech.top

# 更新后端
echo ">>> 更新后端..."
source venv/bin/activate
pip install -r requirements.txt -q
systemctl restart mtcoupon

echo ">>> 后端更新完成"

# 检查服务状态
sleep 3
systemctl status mtcoupon --no-pager

echo "=== 更新完成 ==="
```

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
/www/wwwroot/winscoupons.winstech.top/
├── app/                    # 后端应用
├── venv/                   # Python虚拟环境
├── frontend/               # 前端静态文件
│   ├── index.html
│   ├── assets/
│   └── ...
├── .env                    # 环境配置
├── requirements.txt        # Python依赖
├── gunicorn.conf.py        # Gunicorn配置
└── update.sh               # 更新脚本
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
