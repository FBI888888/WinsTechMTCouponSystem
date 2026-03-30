"""
后端问题诊断脚本
用于检查数据库连接、表结构、用户数据等
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal, engine
from app.models.user import User
from sqlalchemy import text
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    # bcrypt 限制密码最大72字节，截断以防错误
    password_bytes = plain_password.encode('utf-8')[:72]
    return pwd_context.verify(password_bytes, hashed_password)


def diagnose():
    print("=" * 60)
    print("后端诊断开始")
    print("=" * 60)

    # 1. 测试数据库连接
    print("\n1. 测试数据库连接...")
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            print("   ✓ 数据库连接成功")
    except Exception as e:
        print(f"   ✗ 数据库连接失败: {e}")
        print("\n   可能的原因:")
        print("   - 数据库服务未启动")
        print("   - 防火墙未开放3306端口")
        print("   - 数据库用户名或密码错误")
        print("   - 数据库不存在")
        return

    # 2. 检查表是否存在
    print("\n2. 检查数据表...")
    db = SessionLocal()
    try:
        # 检查users表
        result = db.execute(text("SHOW TABLES LIKE 'users'"))
        if result.fetchone():
            print("   ✓ users 表存在")
        else:
            print("   ✗ users 表不存在")
            print("\n   请运行: python init_db.py")
            return

        # 检查其他核心表
        tables = ['accounts', 'orders', 'coupons', 'login_logs', 'operation_logs']
        for table in tables:
            result = db.execute(text(f"SHOW TABLES LIKE '{table}'"))
            if result.fetchone():
                print(f"   ✓ {table} 表存在")
            else:
                print(f"   ✗ {table} 表不存在")
    except Exception as e:
        print(f"   ✗ 检查表失败: {e}")
    finally:
        db.close()

    # 3. 检查管理员用户
    print("\n3. 检查管理员用户...")
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").first()
        if admin:
            print(f"   ✓ 管理员用户存在")
            print(f"     - ID: {admin.id}")
            print(f"     - 用户名: {admin.username}")
            print(f"     - 角色: {admin.role}")
            print(f"     - 状态: {'启用' if admin.is_active else '禁用'}")

            # 测试密码验证
            if verify_password("admin123", admin.password_hash):
                print(f"   ✓ 默认密码验证成功 (admin123)")
            else:
                print(f"   ✗ 默认密码验证失败")
        else:
            print("   ✗ 管理员用户不存在")
            print("\n   请运行: python init_db.py")
    except Exception as e:
        print(f"   ✗ 查询用户失败: {e}")
    finally:
        db.close()

    # 4. 测试登录流程
    print("\n4. 测试登录流程...")
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == "admin").first()
        if user and verify_password("admin123", user.password_hash):
            print("   ✓ 登录测试成功")
            print("\n" + "=" * 60)
            print("诊断完成: 系统正常")
            print("=" * 60)
            print("\n登录凭据:")
            print("  用户名: admin")
            print("  密码: admin123")
        else:
            print("   ✗ 登录测试失败")
    except Exception as e:
        print(f"   ✗ 登录测试异常: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    try:
        diagnose()
    except Exception as e:
        print(f"\n诊断异常: {e}")
        import traceback
        traceback.print_exc()
