"""
Apply P1 order status bucket schema changes.

This migration:
1. Adds orders.order_status_bucket when missing.
2. Backfills historical rows from existing order_status/showstatus values.
3. Adds the account+status+paytime composite index when missing.
"""

import os
import sys

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal


def column_exists(db, table_name: str, column_name: str) -> bool:
    result = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = :table_name
              AND column_name = :column_name
            LIMIT 1
            """
        ),
        {"table_name": table_name, "column_name": column_name},
    )
    return result.first() is not None


def index_exists(db, table_name: str, index_name: str) -> bool:
    result = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.statistics
            WHERE table_schema = DATABASE()
              AND table_name = :table_name
              AND index_name = :index_name
            LIMIT 1
            """
        ),
        {"table_name": table_name, "index_name": index_name},
    )
    return result.first() is not None


def main() -> None:
    db = SessionLocal()
    try:
        if not column_exists(db, "orders", "order_status_bucket"):
            print("APPLY add column orders.order_status_bucket")
            db.execute(text("ALTER TABLE orders ADD COLUMN order_status_bucket VARCHAR(20) NULL AFTER order_status"))
            db.commit()
        else:
            print("SKIP add column orders.order_status_bucket: already exists")

        print("APPLY backfill orders.order_status_bucket")
        db.execute(
            text(
                """
                UPDATE orders
                SET order_status_bucket = CASE
                    WHEN showstatus LIKE '%退款%' THEN 'refund'
                    WHEN showstatus LIKE '%已完成%' OR showstatus LIKE '%待评价%' THEN 'completed'
                    WHEN showstatus LIKE '%待消费%' OR showstatus LIKE '%待使用%' OR order_status = 1 THEN 'pending'
                    ELSE 'other'
                END
                WHERE order_status_bucket IS NULL OR order_status_bucket = ''
                """
            )
        )
        db.commit()

        print("APPLY enforce NOT NULL for orders.order_status_bucket")
        db.execute(text("ALTER TABLE orders MODIFY COLUMN order_status_bucket VARCHAR(20) NOT NULL"))
        db.commit()

        if not index_exists(db, "orders", "idx_orders_account_status_bucket_paytime_id"):
            print("APPLY idx_orders_account_status_bucket_paytime_id")
            db.execute(
                text(
                    """
                    ALTER TABLE orders
                    ADD INDEX idx_orders_account_status_bucket_paytime_id (
                        account_id,
                        order_status_bucket,
                        order_pay_time,
                        id
                    )
                    """
                )
            )
            db.commit()
        else:
            print("SKIP idx_orders_account_status_bucket_paytime_id: already exists")

        print("P1 order status bucket migration completed.")
    except SQLAlchemyError as exc:
        db.rollback()
        print(f"P1 order status bucket migration failed: {exc}")
        raise SystemExit(1)
    except Exception as exc:
        db.rollback()
        print(f"P1 order status bucket migration failed: {exc}")
        raise SystemExit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
