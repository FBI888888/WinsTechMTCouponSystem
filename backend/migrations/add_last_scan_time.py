"""
数据库迁移脚本 - 添加 last_scan_time 列到 mt_accounts 表
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from app.database import engine, SessionLocal

def migrate():
    """添加 last_scan_time 列"""
    db = SessionLocal()
    try:
        # 检查列是否已存在
        result = db.execute(text("""
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'mt_accounts'
            AND COLUMN_NAME = 'last_scan_time'
        """))
        if result.fetchone():
            print("last_scan_time 列已存在，跳过迁移")
            return

        # 添加 last_scan_time 列
        db.execute(text("""
            ALTER TABLE mt_accounts
            ADD COLUMN last_scan_time DATETIME NULL
            COMMENT '最后扫描时间'
        """))
        db.commit()
        print("成功添加 last_scan_time 列")

    except Exception as e:
        print(f"迁移失败: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    migrate()
