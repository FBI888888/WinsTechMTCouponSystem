"""
数据库初始化脚本 - 创建默认管理员用户和系统配置
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from passlib.context import CryptContext
from app.database import SessionLocal, init_db
from app.models.user import User
from app.models.config import SystemConfig

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_password_hash(password: str) -> str:
    # bcrypt 限制密码最大72字节，截断以防错误
    password_bytes = password.encode('utf-8')[:72]
    return pwd_context.hash(password_bytes)


def create_default_admin():
    """创建默认管理员账户"""
    init_db()

    db = SessionLocal()
    try:
        # Check if admin exists
        admin = db.query(User).filter(User.username == "admin").first()
        if admin:
            print("管理员用户已存在")
            return

        # Create admin user
        admin = User(
            username="admin",
            password_hash=get_password_hash("admin123"),
            role="admin",
            is_active=True
        )
        db.add(admin)
        db.commit()
        print("默认管理员账户创建成功!")
        print("用户名: admin")
        print("密码: admin123")
        print("请及时修改默认密码!")

    except Exception as e:
        print(f"创建失败: {e}")
        db.rollback()
    finally:
        db.close()


def init_wechat_configs():
    """初始化微信通知相关配置"""
    db = SessionLocal()
    try:
        configs = [
            {
                "config_key": "wechat_from_wxid",
                "config_value": "",
                "config_type": "string",
                "category": "notification",
                "description": "微信消息发送者ID (from_wxid)"
            },
            {
                "config_key": "wechat_to_wxid",
                "config_value": "",
                "config_type": "string",
                "category": "notification",
                "description": "微信消息接收者ID (to_wxid)"
            },
            {
                "config_key": "wechat_notification_enabled",
                "config_value": "false",
                "config_type": "boolean",
                "category": "notification",
                "description": "是否启用微信消息通知"
            }
        ]

        for config_data in configs:
            existing = db.query(SystemConfig).filter(
                SystemConfig.config_key == config_data["config_key"]
            ).first()
            if not existing:
                config = SystemConfig(**config_data)
                db.add(config)
                print(f"创建配置: {config_data['config_key']}")

        db.commit()
        print("微信通知配置初始化完成!")

    except Exception as e:
        print(f"初始化微信配置失败: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    create_default_admin()
    init_wechat_configs()
