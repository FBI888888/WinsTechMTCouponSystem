import unittest
from unittest.mock import MagicMock

from app.models.account import MTAccount
from app.services.ownership_backfill import backfill_unowned_accounts


class OwnershipBackfillTests(unittest.TestCase):
    def test_assigns_only_unowned_accounts_to_earliest_active_admin(self):
        db = MagicMock()
        user_query = MagicMock()
        account_query = MagicMock()
        db.query.side_effect = [user_query, account_query]
        user_query.filter.return_value.order_by.return_value.scalar.return_value = 1
        account_query.filter.return_value.update.return_value = 75

        updated, owner_id = backfill_unowned_accounts(db)

        self.assertEqual(75, updated)
        self.assertEqual(1, owner_id)
        update_values = account_query.filter.return_value.update.call_args.args[0]
        self.assertEqual(1, update_values[MTAccount.user_id])
        db.add.assert_called_once()
        db.commit.assert_called_once()

    def test_does_nothing_without_an_active_admin(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.scalar.return_value = None

        updated, owner_id = backfill_unowned_accounts(db)

        self.assertEqual(0, updated)
        self.assertIsNone(owner_id)
        db.commit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
