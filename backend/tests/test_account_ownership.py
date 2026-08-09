import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.routers import accounts


class AccountOwnershipTests(unittest.TestCase):
    def test_account_list_always_applies_current_user_filter_for_admin(self):
        db = MagicMock()
        query = MagicMock()
        db.query.return_value = query
        query.filter.return_value = query
        query.offset.return_value = query
        query.limit.return_value = query
        query.all.return_value = []

        accounts.get_accounts(
            db=db,
            current_user=SimpleNamespace(id=8, role="admin"),
        )

        self.assertTrue(query.filter.called)
        expression = str(query.filter.call_args.args[0])
        self.assertIn("mt_accounts.user_id", expression)

    def test_owned_detail_lookup_uses_both_owner_and_account_id(self):
        db = MagicMock()
        query = MagicMock()
        db.query.return_value = query
        query.filter.return_value = query
        query.first.return_value = None

        result = accounts._get_owned_account(
            db,
            SimpleNamespace(id=3, role="admin"),
            99,
        )

        self.assertIsNone(result)
        self.assertEqual(2, query.filter.call_count)


if __name__ == "__main__":
    unittest.main()
