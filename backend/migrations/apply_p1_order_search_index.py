"""
Apply P1 order search index hardening.

This migration adds an account + order_view_id index so the optimized
order search path can use exact/prefix matching efficiently.
"""

import os
import sys

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal


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
        if not index_exists(db, "orders", "idx_orders_account_order_view_id"):
            print("APPLY idx_orders_account_order_view_id")
            db.execute(
                text(
                    """
                    ALTER TABLE orders
                    ADD INDEX idx_orders_account_order_view_id (
                        account_id,
                        order_view_id
                    )
                    """
                )
            )
            db.commit()
        else:
            print("SKIP idx_orders_account_order_view_id: already exists")

        print("P1 order search index migration completed.")
    except SQLAlchemyError as exc:
        db.rollback()
        print(f"P1 order search index migration failed: {exc}")
        raise SystemExit(1)
    except Exception as exc:
        db.rollback()
        print(f"P1 order search index migration failed: {exc}")
        raise SystemExit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
