import hashlib
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.schemas.gift_claim import GiftClaimSaveRequest
from app.services import gift_claim_service as service


def _hash(value: str) -> str:
    return hashlib.sha256(value.strip().encode("utf-8")).hexdigest()


class GiftClaimServiceTests(unittest.TestCase):
    def test_find_gift_claim_by_hash_only(self):
        db = MagicMock()
        claim = SimpleNamespace(id=3, gift_id=None, gift_id_encrypt_hash="a" * 64)
        q = MagicMock()
        q.filter.return_value.first.return_value = claim
        db.query.return_value = q
        found = service.find_gift_claim(db, gift_id_encrypt_hash="a" * 64)
        self.assertIs(claim, found)

    def test_find_gift_claim_conflict_raises_409(self):
        db = MagicMock()
        by_hash = SimpleNamespace(id=1)
        by_gift = SimpleNamespace(id=2)
        state = {"n": 0}

        def query_side_effect(_model):
            q = MagicMock()

            def filter_side_effect(*_args, **_kwargs):
                state["n"] += 1
                filt = MagicMock()
                filt.first.return_value = by_hash if state["n"] == 1 else by_gift
                return filt

            q.filter.side_effect = filter_side_effect
            return q

        db.query.side_effect = query_side_effect
        with self.assertRaises(HTTPException) as ctx:
            service.find_gift_claim(db, gift_id="gift-b", gift_id_encrypt_hash="b" * 64)
        self.assertEqual(409, ctx.exception.status_code)

    def test_save_encrypt_only_creates_without_requiring_gift_id(self):
        db = MagicMock()
        account = SimpleNamespace(id=7)
        db.query.return_value.filter.return_value.first.return_value = account
        request = GiftClaimSaveRequest(
            account_id=7,
            gift_id=None,
            gift_id_encrypt_hash=_hash("encrypt-only"),
            order_id="order-shared",
            gift_type="meituan",
        )

        with patch.object(service, "find_gift_claim", return_value=None), patch.object(
            service, "_upsert_order_projection", return_value=None
        ) as order_mock, patch.object(
            service, "_upsert_coupon_projection", return_value=None
        ), patch.object(
            service, "_increment_account_claim_count"
        ), patch.object(
            service, "serialize_gift_claim", return_value={"found": True, "is_new_claim": True}
        ):
            result = service.save_gift_claim(db, request)

        self.assertTrue(result["is_new_claim"])
        self.assertTrue(db.add.called)
        claim_arg = order_mock.call_args.args[1]
        self.assertIsNone(claim_arg.gift_id)
        self.assertEqual(_hash("encrypt-only"), claim_arg.gift_id_encrypt_hash)

    def test_save_same_hash_is_idempotent_and_backfills_gift_id(self):
        db = MagicMock()
        existing = SimpleNamespace(
            id=9,
            account_id=7,
            gift_id=None,
            gift_id_encrypt_hash=_hash("encrypt-1"),
            source_order_id="order-1",
            title=None,
            raw_data=None,
            coupon_code=None,
            coupon_query_status=0,
            coupon_queried_at=None,
            gift_type="meituan",
            data_source="wxbot_gift_submit",
            order_db_id=None,
            coupon_id=None,
            claimed_at=datetime.now(),
            updated_at=datetime.now(),
        )
        account = SimpleNamespace(id=7)
        db.query.return_value.filter.return_value.first.return_value = account
        request = GiftClaimSaveRequest(
            account_id=7,
            gift_id="gift-plain-1",
            gift_id_encrypt_hash=_hash("encrypt-1"),
            order_id="order-1",
            coupon_code="coupon-1",
        )

        with patch.object(service, "find_gift_claim", return_value=existing), patch.object(
            service, "_upsert_order_projection", return_value=SimpleNamespace(id=1, coupon_query_status=0)
        ), patch.object(
            service,
            "_upsert_coupon_projection",
            return_value=SimpleNamespace(id=2, coupon_code="coupon-1"),
        ), patch.object(
            service, "serialize_gift_claim", side_effect=lambda claim, **kwargs: {
                "found": True,
                "is_new_claim": kwargs.get("is_new_claim", False),
                "gift_id": claim.gift_id,
                "coupon_code": claim.coupon_code,
                "account_id": claim.account_id,
            }
        ):
            result = service.save_gift_claim(db, request)

        self.assertFalse(result["is_new_claim"])
        self.assertEqual("gift-plain-1", existing.gift_id)
        self.assertEqual("coupon-1", existing.coupon_code)
        self.assertEqual(1, existing.coupon_query_status)

    def test_save_rejects_missing_gift_and_hash(self):
        db = MagicMock()
        request = GiftClaimSaveRequest(account_id=1, gift_id=None, gift_id_encrypt_hash=None)
        with self.assertRaises(HTTPException) as ctx:
            service.save_gift_claim(db, request)
        self.assertEqual(400, ctx.exception.status_code)

    def test_account_locked_on_different_account(self):
        db = MagicMock()
        existing = SimpleNamespace(account_id=1, id=3)
        account = SimpleNamespace(id=2)
        db.query.return_value.filter.return_value.first.return_value = account
        request = GiftClaimSaveRequest(
            account_id=2,
            gift_id="gift-x",
            gift_id_encrypt_hash=_hash("encrypt-x"),
        )
        with patch.object(service, "find_gift_claim", return_value=existing), patch.object(
            service,
            "serialize_gift_claim",
            return_value={"found": True, "account_locked": True, "account_id": 1},
        ) as serialize_mock:
            result = service.save_gift_claim(db, request)
        self.assertTrue(result["account_locked"])
        serialize_mock.assert_called_once()

    def test_normalize_encrypt_hash_rejects_invalid(self):
        self.assertEqual("", service._normalize_encrypt_hash("not-a-hash"))
        self.assertEqual("a" * 64, service._normalize_encrypt_hash(("A" * 64)))


if __name__ == "__main__":
    unittest.main()
