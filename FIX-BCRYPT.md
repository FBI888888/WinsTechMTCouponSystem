# bcrypt 密码错误修复指南

## 问题描述

登录时报错：
```
ValueError: password cannot be longer than 72 bytes, truncate manually if necessary
```

这是 bcrypt 算法的限制，密码最大长度为 72 字节。

## 快速修复步骤

### 1. 更新代码

```bash
cd /www/wwwroot/winscoupons.winstech.top
git pull
```

### 2. 更新依赖

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
```

这会安装 `bcrypt==4.0.1`，解决兼容性问题。

### 3. 重启服务

**使用Python项目管理器**：
- 宝塔面板 → Python项目管理器 → mtcoupon → 重启

**使用Systemd**：
```bash
systemctl restart mtcoupon
```

### 4. 验证修复

```bash
cd backend
source venv/bin/activate
python diagnose.py
```

应该显示：
```
✓ 数据库连接成功
✓ users 表存在
✓ 管理员用户存在
✓ 默认密码验证成功 (admin123)
✓ 登录测试成功
```

### 5. 测试登录

打开客户端应用，使用以下凭据登录：
- 用户名: `admin`
- 密码: `admin123`

## 代码修改说明

已修改以下文件：

1. **requirements.txt** - 添加 `bcrypt==4.0.1`
2. **app/routers/auth.py** - 密码哈希前截断到72字节
3. **init_db.py** - 创建用户时使用相同的哈希逻辑
4. **diagnose.py** - 诊断脚本使用相同的验证逻辑

## 如果问题仍然存在

### 方案一：重新创建管理员用户

```bash
cd /www/wwwroot/winscoupons.winstech.top/backend
source venv/bin/activate

# 删除现有管理员
python << 'EOF'
from app.database import SessionLocal
from app.models.user import User
db = SessionLocal()
admin = db.query(User).filter(User.username == "admin").first()
if admin:
    db.delete(admin)
    db.commit()
    print("已删除旧管理员")
db.close()
EOF

# 重新创建
python init_db.py
```

### 方案二：完整重置

```bash
cd /www/wwwroot/winscoupons.winstech.top/backend
source venv/bin/activate

# 重新安装依赖
pip install --force-reinstall passlib[bcrypt]==1.7.4 bcrypt==4.0.1

# 重启服务
systemctl restart mtcoupon
```

## 检查日志

如果仍有问题，查看详细日志：

```bash
# Systemd日志
journalctl -u mtcoupon -n 100

# 或宝塔日志
cat /www/wwwlogs/mtcoupon_error.log
```
