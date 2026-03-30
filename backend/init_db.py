"""
数据库初始化脚本 - 创建默认管理员用户
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from passlib.context import CryptContext
from app.database import SessionLocal, init_db
from app.models.user import User

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


if __name__ == "__main__":
    create_default_admin()
