import json

from sqlalchemy.orm import Session

from app.models.account import MTAccount
from app.models.log import OperationLog
from app.models.user import User


def backfill_unowned_accounts(db: Session) -> tuple[int, int | None]:
    """
    将旧版本创建的 user_id=NULL 私有账号归给最早的有效管理员。

    该管理员即当前系统的 workspace owner。只有无归属账号会被更新，
    已有用户归属绝不会被改写；函数可在每次启动时安全重复执行。
    """
    owner_id = (
        db.query(User.id)
        .filter(
            User.role == "admin",
            User.is_active.is_(True),
        )
        .order_by(User.id.asc())
        .scalar()
    )
    if owner_id is None:
        return 0, None

    updated = (
        db.query(MTAccount)
        .filter(MTAccount.user_id.is_(None))
        .update(
            {MTAccount.user_id: owner_id},
            synchronize_session=False,
        )
    )
    if not updated:
        return 0, owner_id

    db.add(
        OperationLog(
            user_id=owner_id,
            action="backfill_account_owner",
            target_type="user",
            target_id=owner_id,
            details=json.dumps(
                {
                    "assigned_account_count": updated,
                    "rule": "earliest_active_admin",
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return updated, owner_id
