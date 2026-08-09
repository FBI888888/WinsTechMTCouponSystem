import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import HTTPException
from pydantic import ValidationError

from app.routers import gift_claims
from app.schemas.gift_claim import GiftClaimEventRequest, GiftClaimSaveRequest


class GiftClaimSecurityTests(unittest.TestCase):
    def test_temporary_event_rejects_credential_fields(self):
        with self.assertRaises(ValidationError):
            GiftClaimEventRequest(
                gift_id="gift-1",
                order_id="order-1",
                platform="windows",
                status="success",
                token="secret",
            )

    def test_temporary_event_message_is_sanitized(self):
        request = GiftClaimEventRequest(
            gift_id="gift-1",
            order_id="order-1",
            platform="android",
            status="failed",
            result_code=1011,
            message=(
                "token=very-secret Cookie:cookie-secret "
                "https://example.test/?mtgsig=signature"
            ),
        )
        details = gift_claims._event_details(request)
        payload = json.loads(details)
        self.assertNotIn("very-secret", details)
        self.assertNotIn("cookie-secret", details)
        self.assertNotIn("signature", details)
        self.assertEqual("temporary", payload["credential_kind"])

    def test_saved_event_requires_an_owned_account(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        current_user = SimpleNamespace(id=1, role="admin")
        request = GiftClaimEventRequest(
            gift_id="gift-1",
            platform="windows",
            status="failed",
            recipient_kind="saved",
            account_id=99,
        )

        with self.assertRaises(HTTPException) as ctx:
            gift_claims.persist_gift_claim_event(
                request,
                db=db,
                current_user=current_user,
            )

        self.assertEqual(404, ctx.exception.status_code)

    def test_saved_attempt_event_is_logged_without_credentials(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(id=4, user_id=1)
        current_user = SimpleNamespace(id=1, role="admin")
        request = GiftClaimEventRequest(
            gift_id="gift-4",
            order_id="order-4",
            platform="android",
            status="failed",
            result_code=5084,
            attempts=3,
            message="礼物已无法领取",
            recipient_kind="saved",
            account_id=4,
        )

        result = gift_claims.persist_gift_claim_event(
            request,
            db=db,
            current_user=current_user,
        )

        self.assertTrue(result["success"])
        logged = db.add.call_args.args[0]
        self.assertEqual("gift_claim_attempt", logged.action)
        self.assertIn('"credential_kind": "saved"', logged.details)
        self.assertIn('"attempts": 3', logged.details)
        self.assertNotIn("token", logged.details.lower())
        db.commit.assert_called_once()

    def test_admin_cannot_persist_to_another_users_account(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        admin = SimpleNamespace(id=7, role="admin")
        request = GiftClaimSaveRequest(account_id=99, gift_id="gift-1")

        with self.assertRaises(HTTPException) as ctx:
            gift_claims.persist_gift_claim(request, db=db, current_user=admin)

        self.assertEqual(404, ctx.exception.status_code)

    def test_cross_user_precheck_only_returns_generic_conflict(self):
        claim = SimpleNamespace(
            account=SimpleNamespace(user_id=2),
            account_id=44,
            gift_id="secret-gift",
        )
        db = MagicMock()
        current_user = SimpleNamespace(id=1, role="user")

        from unittest.mock import patch

        with patch.object(gift_claims, "find_gift_claim", return_value=claim):
            result = gift_claims.precheck_gift_claim(
                gift_id="secret-gift",
                db=db,
                current_user=current_user,
            )

        self.assertTrue(result["found"])
        self.assertTrue(result["account_locked"])
        self.assertNotIn("account_id", result)
        self.assertNotIn("gift_id", result)


if __name__ == "__main__":
    unittest.main()
