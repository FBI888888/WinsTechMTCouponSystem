"""
Apply P0 schema hardening for constraints and indexes.

This migration is intentionally conservative:
1. It aborts if duplicate rows would block unique constraints.
2. It only creates constraints / indexes that do not already exist.
"""

import os
import sys

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal


DDL_STATEMENTS = [
    (
        "orders",
        "uq_orders_account_order_id",
        "ALTER TABLE orders ADD CONSTRAINT uq_orders_account_order_id UNIQUE (account_id, order_id)",
    ),
    (
        "coupons",
        "uq_coupons_order_coupon_code",
        "ALTER TABLE coupons ADD CONSTRAINT uq_coupons_order_coupon_code UNIQUE (order_id, coupon_code)",
    ),
    (
        "orders",
        "idx_orders_account_paytime_id",
        "ALTER TABLE orders ADD INDEX idx_orders_account_paytime_id (account_id, order_pay_time, id)",
    ),
    (
        "orders",
        "idx_orders_account_coupon_query_paytime_id",
        """
        ALTER TABLE orders
        ADD INDEX idx_orders_account_coupon_query_paytime_id (
            account_id,
            coupon_query_status,
            order_pay_time,
            id
        )
        """,
    ),
    (
        "coupons",
        "idx_coupons_account_query_time",
        "ALTER TABLE coupons ADD INDEX idx_coupons_account_query_time (account_id, query_time)",
    ),
    (
        "coupon_history",
        "idx_coupon_history_coupon_changed_id",
        "ALTER TABLE coupon_history ADD INDEX idx_coupon_history_coupon_changed_id (coupon_id, changed_at, id)",
    ),
    (
        "coupon_history",
        "idx_coupon_history_old_changed_id",
        "ALTER TABLE coupon_history ADD INDEX idx_coupon_history_old_changed_id (old_coupon_code, changed_at, id)",
    ),
]


def has_duplicate_orders(db) -> bool:
    result = db.execute(
        text(
            """
            SELECT 1
            FROM orders
            GROUP BY account_id, order_id
            HAVING COUNT(*) > 1
            LIMIT 1
            """
        )
    )
    return result.first() is not None


def has_duplicate_coupons(db) -> bool:
    result = db.execute(
        text(
            """
            SELECT 1
            FROM coupons
            WHERE coupon_code IS NOT NULL
            GROUP BY order_id, coupon_code
            HAVING COUNT(*) > 1
            LIMIT 1
            """
        )
    )
    return result.first() is not None


def object_exists(db, table_name: str, object_name: str) -> bool:
    result = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.statistics
            WHERE table_schema = DATABASE()
              AND table_name = :table_name
              AND index_name = :object_name
            UNION ALL
            SELECT 1
            FROM information_schema.table_constraints
            WHERE table_schema = DATABASE()
              AND table_name = :table_name
              AND constraint_name = :object_name
            LIMIT 1
            """
        ),
        {"table_name": table_name, "object_name": object_name},
    )
    return result.first() is not None


def main() -> None:
    db = SessionLocal()
    try:
        if has_duplicate_orders(db):
            raise RuntimeError("Duplicate (account_id, order_id) rows found in orders. Resolve them before applying P0 hardening.")

        if has_duplicate_coupons(db):
            raise RuntimeError("Duplicate (order_id, coupon_code) rows found in coupons. Resolve them before applying P0 hardening.")

        for table_name, object_name, ddl in DDL_STATEMENTS:
            if object_exists(db, table_name, object_name):
                print(f"SKIP {object_name}: already exists")
                continue

            print(f"APPLY {object_name}")
            db.execute(text(ddl))
            db.commit()

        print("P0 schema hardening completed.")
    except SQLAlchemyError as exc:
        db.rollback()
        print(f"P0 schema hardening failed: {exc}")
        raise SystemExit(1)
    except Exception as exc:
        db.rollback()
        print(f"P0 schema hardening failed: {exc}")
        raise SystemExit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
