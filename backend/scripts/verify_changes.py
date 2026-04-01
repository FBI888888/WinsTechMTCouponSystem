"""
券码变更功能验证脚本
运行此脚本检查所有修改是否正确

使用方法:
cd backend
python scripts/verify_changes.py
"""

import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def check_models():
    """检查模型定义"""
    print("=" * 50)
    print("1. 检查模型定义...")
    print("=" * 50)

    try:
        from app.models.coupon import Coupon
        from app.models.coupon_history import CouponHistory
        from app.models.order import Order
        from app.models.account import MTAccount

        # 检查 Coupon 模型是否有 history 关系
        if hasattr(Coupon, 'history'):
            print("✓ Coupon.history 关系定义正确")
        else:
            print("✗ Coupon.history 关系缺失!")
            return False

        # 检查 CouponHistory 模型
        if hasattr(CouponHistory, 'old_coupon_code') and hasattr(CouponHistory, 'new_coupon_code'):
            print("✓ CouponHistory 模型字段定义正确")
        else:
            print("✗ CouponHistory 模型字段缺失!")
            return False

        print("模型检查通过!\n")
        return True

    except Exception as e:
        print(f"✗ 模型导入错误: {e}\n")
        return False


def check_schemas():
    """检查 Schema 定义"""
    print("=" * 50)
    print("2. 检查 Schema 定义...")
    print("=" * 50)

    try:
        from app.schemas.coupon import (
            CouponQueryResponse,
            CouponBackendQueryResponse,
            CouponChangeInfo
        )

        # 检查字段
        query_fields = CouponQueryResponse.model_fields
        if 'is_old_code' in query_fields and 'change_info' in query_fields:
            print("✓ CouponQueryResponse 字段定义正确")
        else:
            print("✗ CouponQueryResponse 缺少变更相关字段!")
            return False

        backend_fields = CouponBackendQueryResponse.model_fields
        if 'code_changed' in backend_fields and 'change_type' in backend_fields:
            print("✓ CouponBackendQueryResponse 字段定义正确")
        else:
            print("✗ CouponBackendQueryResponse 缺少变更相关字段!")
            return False

        print("Schema 检查通过!\n")
        return True

    except Exception as e:
        print(f"✗ Schema 导入错误: {e}\n")
        return False


def check_services():
    """检查服务层"""
    print("=" * 50)
    print("3. 检查服务层...")
    print("=" * 50)

    try:
        from app.services.coupon_change_service import (
            find_coupon_by_code,
            batch_find_coupons_by_codes,
            CouponChangeDetector,
            apply_coupon_changes,
            get_coupon_change_info
        )

        print("✓ 服务层函数导入成功")

        # 检查 CouponChangeDetector 类
        detector_attrs = ['detect_changes', 'db_code_map', 'api_code_map']
        for attr in detector_attrs:
            if hasattr(CouponChangeDetector, attr) or attr in dir(CouponChangeDetector):
                continue
            else:
                print(f"✗ CouponChangeDetector 缺少 {attr}!")
                return False

        print("✓ CouponChangeDetector 类定义正确")
        print("服务层检查通过!\n")
        return True

    except Exception as e:
        print(f"✗ 服务层导入错误: {e}\n")
        return False


def check_database():
    """检查数据库表"""
    print("=" * 50)
    print("4. 检查数据库表...")
    print("=" * 50)

    try:
        from app.database import engine
        from sqlalchemy import inspect

        inspector = inspect(engine)

        # 检查 coupon_history 表是否存在
        tables = inspector.get_table_names()
        if 'coupon_history' in tables:
            print("✓ coupon_history 表已创建")

            # 检查字段
            columns = [col['name'] for col in inspector.get_columns('coupon_history')]
            required_columns = ['id', 'coupon_id', 'order_id', 'account_id',
                              'old_coupon_code', 'new_coupon_code', 'changed_at']

            missing = [col for col in required_columns if col not in columns]
            if missing:
                print(f"✗ coupon_history 表缺少字段: {missing}")
                return False
            print("✓ coupon_history 表字段完整")

            # 检查索引
            indexes = inspector.get_indexes('coupon_history')
            index_names = [idx['name'] for idx in indexes]
            if 'idx_old_coupon_code' in index_names:
                print("✓ coupon_history 表索引已创建")
            else:
                print("⚠ coupon_history 表可能缺少索引")

        else:
            print("✗ coupon_history 表不存在!")
            print("  请执行迁移脚本: mysql -u root -p mt_coupon < migrations/add_coupon_history_simple.sql")
            return False

        print("数据库检查通过!\n")
        return True

    except Exception as e:
        print(f"✗ 数据库检查错误: {e}")
        print("  请确保数据库连接正确，并执行迁移脚本\n")
        return False


def main():
    print("\n" + "=" * 50)
    print(" 券码变更功能验证脚本")
    print("=" * 50 + "\n")

    results = []

    # 1. 检查模型
    results.append(("模型定义", check_models()))

    # 2. 检查 Schema
    results.append(("Schema定义", check_schemas()))

    # 3. 检查服务层
    results.append(("服务层", check_services()))

    # 4. 检查数据库
    results.append(("数据库表", check_database()))

    # 汇总结果
    print("=" * 50)
    print(" 验证结果汇总")
    print("=" * 50)

    all_passed = True
    for name, passed in results:
        status = "✓ 通过" if passed else "✗ 失败"
        print(f"  {name}: {status}")
        if not passed:
            all_passed = False

    print()
    if all_passed:
        print("所有检查通过! 券码变更功能已正确安装。")
    else:
        print("部分检查未通过，请根据上述提示进行修复。")

    return all_passed


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
