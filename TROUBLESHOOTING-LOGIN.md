# 登录失败问题排查

## 问题描述

登录显示"Login failed"，接口返回500错误。

## 快速诊断

SSH登录服务器，运行诊断脚本：

```bash
cd /www/wwwroot/winscoupons.winstech.top/backend
source venv/bin/activate
python diagnose.py
```

## 常见原因及解决方案

### 1. 数据库未初始化

**症状**：诊断显示 "users 表不存在" 或 "管理员用户不存在"

**解决方案**：
```bash
cd /www/wwwroot/winscoupons.winstech.top/backend
source venv/bin/activate
python init_db.py
```

输出应该显示：
```
默认管理员账户创建成功!
用户名: admin
密码: admin123
```

### 2. 数据库连接失败

**症状**：诊断显示 "数据库连接失败"

**排查步骤**：

```bash
# 1. 检查数据库服务
mysql -h winssql.winstech.top -u root -p

# 2. 检查防火墙
宝塔面板 -> 安全 -> 查看是否有 3306 端口规则

# 3. 检查数据库用户权限
mysql> GRANT ALL PRIVILEGES ON mt_coupon.* TO 'root'@'%';
mysql> FLUSH PRIVILEGES;

# 4. 检查 .env 配置
cd /www/wwwroot/winscoupons.winstech.top/backend
nano .env
```

确保配置正确：
```ini
DB_HOST=winssql.winstech.top
DB_PORT=3306
DB_NAME=mt_coupon
DB_USER=root
DB_PASSWORD=你的实际密码
```

### 3. 环境变量未生效

**症状**：数据库连接使用了错误的配置

**解决方案**：

如果使用宝塔Python项目管理器：
1. 项目设置 → 环境变量
2. 确保添加了所有必要的环境变量
3. 重启项目

如果使用Systemd服务：
```bash
# 检查 .env 文件
cat /www/wwwroot/winscoupons.winstech.top/backend/.env

# 重启服务
systemctl restart mtcoupon
```

### 4. 服务启动异常

**症状**：后端服务未正常运行

**排查步骤**：

```bash
# 检查服务状态
systemctl status mtcoupon

# 查看日志
journalctl -u mtcoupon -n 50

# 或查看宝塔日志
cat /www/wwwlogs/mtcoupon_error.log
```

### 5. 密码错误

**症状**：诊断显示"默认密码验证失败"

**解决方案**：重置管理员密码

```bash
cd /www/wwwroot/winscoupons.winstech.top/backend
source venv/bin/activate

python << 'EOF'
from app.database import SessionLocal
from app.models.user import User
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password: str) -> str:
    password_bytes = password.encode('utf-8')[:72]
    return pwd_context.hash(password_bytes)

db = SessionLocal()

admin = db.query(User).filter(User.username == "admin").first()
if admin:
    admin.password_hash = get_password_hash("admin123")
    db.commit()
    print("密码已重置为: admin123")
else:
    print("管理员用户不存在，请先运行 python init_db.py")

db.close()
EOF
```

## 完整重置步骤

如果以上都无法解决，执行完整重置：

```bash
cd /www/wwwroot/winscoupons.winstech.top/backend
source venv/bin/activate

# 1. 删除数据库（注意：会清空所有数据）
mysql -h winssql.winstech.top -u root -p -e "DROP DATABASE IF EXISTS mt_coupon;"

# 2. 重新创建数据库
mysql -h winssql.winstech.top -u root -p -e "CREATE DATABASE mt_coupon CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 3. 初始化表和用户
python init_db.py

# 4. 运行诊断验证
python diagnose.py

# 5. 重启服务
systemctl restart mtcoupon
```

## 验证登录

```bash
# 测试登录API
curl -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

成功应该返回：
```json
{
  "access_token": "eyJ...",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin"
  }
}
```

## 联系支持

如果问题仍未解决，提供以下信息：
1. `python diagnose.py` 的完整输出
2. `journalctl -u mtcoupon -n 100` 的日志输出
3. 登录时的具体错误信息
