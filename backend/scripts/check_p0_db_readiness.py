"""
Preflight checks for P0 schema hardening.

This script is intentionally read-only. It reports duplicate keys that would
block unique constraints and shows whether the expected P0 indexes already
exist in the current database.
"""

import os
import sys

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal


EXPECTED_INDEXES = {
    "orders": {
        "uq_orders_account_order_id",
        "idx_orders_account_paytime_id",
        "idx_orders_account_coupon_query_paytime_id",
    },
    "coupons": {
        "uq_coupons_order_coupon_code",
        "idx_coupons_account_query_time",
    },
    "coupon_history": {
        "idx_coupon_history_coupon_changed_id",
        "idx_coupon_history_old_changed_id",
    },
}


def print_section(title: str) -> None:
    print()
    print("=" * 72)
    print(title)
    print("=" * 72)


def fetch_duplicate_rows(db, sql: str):
    return db.execute(text(sql)).mappings().all()


def fetch_indexes(db, table_name: str):
    rows = db.execute(text(f"SHOW INDEX FROM {table_name}")).mappings().all()
    return {row["Key_name"] for row in rows}


def main() -> None:
    db = SessionLocal()
    try:
        print_section("Duplicate check: orders(account_id, order_id)")
        order_duplicates = fetch_duplicate_rows(
            db,
            """
            SELECT account_id, order_id, COUNT(*) AS duplicate_count
            FROM orders
            GROUP BY account_id, order_id
            HAVING COUNT(*) > 1
            ORDER BY duplicate_count DESC, account_id ASC, order_id ASC
            LIMIT 50
            """,
        )
        if not order_duplicates:
            print("OK: no duplicate (account_id, order_id) rows found.")
        else:
            for row in order_duplicates:
                print(
                    f"account_id={row['account_id']} order_id={row['order_id']} duplicate_count={row['duplicate_count']}"
                )

        print_section("Duplicate check: coupons(order_id, coupon_code)")
        coupon_duplicates = fetch_duplicate_rows(
            db,
            """
            SELECT order_id, coupon_code, COUNT(*) AS duplicate_count
            FROM coupons
            WHERE coupon_code IS NOT NULL
            GROUP BY order_id, coupon_code
            HAVING COUNT(*) > 1
            ORDER BY duplicate_count DESC, order_id ASC, coupon_code ASC
            LIMIT 50
            """,
        )
        if not coupon_duplicates:
            print("OK: no duplicate (order_id, coupon_code) rows found.")
        else:
            for row in coupon_duplicates:
                print(
                    f"order_id={row['order_id']} coupon_code={row['coupon_code']} duplicate_count={row['duplicate_count']}"
                )

        print_section("Index / constraint presence")
        for table_name, expected in EXPECTED_INDEXES.items():
            existing = fetch_indexes(db, table_name)
            missing = sorted(expected - existing)
            print(f"{table_name}:")
            if not missing:
                print("  OK: all expected P0 indexes/constraints are present.")
            else:
                for name in missing:
                    print(f"  MISSING: {name}")

    except SQLAlchemyError as exc:
        print(f"Database readiness check failed: {exc}")
        raise SystemExit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
