import json
import unittest
from unittest.mock import AsyncMock, patch
from datetime import datetime, timedelta

from app.services.meituan_native_login import exchange_native_credential
from app.services.native_fingerprint import (
    FINGERPRINT_PREFIX,
    build_account_fingerprint,
    decode_fingerprint,
    encode_fingerprint,
    generate_lxcuid,
)
from app.services.native_credentials import _task_result, native_credentials_stale
from app.services.wxcode_client import WxcodeOpenAPIClient
from app.models.account import MTAccount
from app.config import settings
from app.utils.encryption import TokenEncryption


class _FakeResponse:
    status_code = 200

    def json(self):
        return {
            "data": {
                "userId": 1055781219,
                "token": "native-token",
                "openId": "native-open",
                "openIdCipher": "native-open-cipher",
                "unionId": "native-union",
                "unionIdCipher": "native-union-cipher",
            }
        }


class _FakeAsyncClient:
    posted = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, **kwargs):
        type(self).posted = {"url": url, **kwargs}
        return _FakeResponse()


class NativeCredentialTests(unittest.IsolatedAsyncioTestCase):
    def test_fingerprint_aes_roundtrip_and_realistic_shape(self):
        sample = {"hello": "world", "unicode": "微信"}
        encoded = encode_fingerprint(sample)
        self.assertTrue(encoded.startswith(FINGERPRINT_PREFIX))
        self.assertEqual(decode_fingerprint(encoded), sample)
        self.assertEqual(
            encode_fingerprint({"hello": "world", "n": 123}),
            "WX__ver1.2.0_CCCC_kkqh4WoU7NU6p//6wrovChqsJ1eifJ6EdopBaoNEg80=",
        )

        generated = decode_fingerprint(build_account_fingerprint())
        self.assertEqual(generated["app"], "wxde8ac0a21135c07d")
        self.assertEqual(generated["system"]["platform"], "windows")
        self.assertIn("LaunchOptionsSync", generated["system"])
        json.loads(generated["system"]["LaunchOptionsSync"])

    def test_lxcuid_has_expected_five_part_shape(self):
        value = generate_lxcuid("ua", "414*780")
        self.assertEqual(len(value.split("-")), 5)

    def test_stable_passphrase_encryption_roundtrip(self):
        original_enabled = settings.TOKEN_ENCRYPTION_ENABLED
        original_key = settings.ENCRYPTION_KEY
        try:
            settings.TOKEN_ENCRYPTION_ENABLED = True
            settings.ENCRYPTION_KEY = "a-stable-production-passphrase-longer-than-32-characters"
            encryption = TokenEncryption()
            encryption._initialized = False
            encryption._fernet = None
            encoded = encryption.encrypt("secret-token")
            self.assertNotEqual(encoded, "secret-token")
            self.assertEqual(encryption.decrypt(encoded), "secret-token")
        finally:
            settings.TOKEN_ENCRYPTION_ENABLED = original_enabled
            settings.ENCRYPTION_KEY = original_key
            encryption._initialized = False
            encryption._fernet = None

    def test_task_result_keeps_code_and_phone_sources_separate(self):
        phone = {"iv": "iv", "encryptedData": "encrypted", "code": "phone-code"}
        self.assertIs(_task_result({"state": "success", "result": {"phone": phone}}, "phone"), phone)
        self.assertEqual(
            _task_result({"state": "success", "result": {"code": "mini-program-code"}}, "code"),
            "mini-program-code",
        )

    async def test_openapi_submission_uses_appid_kind_and_idempotency_key(self):
        client = WxcodeOpenAPIClient("https://wxcode.test", "server-only-key")
        client._request = AsyncMock(return_value={"task_id": "task-1"})
        task_id = await client.submit_task(
            instance_code="0123456789ABCDEF",
            kind="phone",
            request_id="mtcoupon:nref_1:phone",
        )
        self.assertEqual(task_id, "task-1")
        body = client._request.await_args.kwargs["json_body"]
        self.assertEqual(body["appid"], "wxde8ac0a21135c07d")
        self.assertEqual(body["kind"], "phone")
        self.assertEqual(body["client_request_id"], "mtcoupon:nref_1:phone")

    @patch("app.services.meituan_native_login.httpx.AsyncClient", _FakeAsyncClient)
    async def test_login_ignores_phone_object_code(self):
        result = await exchange_native_credential(
            mini_program_code="mini-program-code",
            phone_payload={"iv": "phone-iv", "encryptedData": "phone-encrypted", "code": "wrong-phone-code"},
            wechat_fingerprint="fingerprint",
            login_uuid="uuid",
        )
        self.assertEqual(_FakeAsyncClient.posted["data"]["code"], "mini-program-code")
        self.assertEqual(_FakeAsyncClient.posted["data"]["iv"], "phone-iv")
        self.assertEqual(result.user_id, "1055781219")

    def test_native_staleness_does_not_apply_to_legacy(self):
        self.assertFalse(native_credentials_stale(MTAccount(credential_source="legacy")))
        self.assertTrue(native_credentials_stale(MTAccount(credential_source="native")))
        self.assertFalse(native_credentials_stale(MTAccount(
            credential_source="native",
            credential_refreshed_at=datetime.now() - timedelta(hours=11),
        )))
        self.assertTrue(native_credentials_stale(MTAccount(
            credential_source="native",
            credential_refreshed_at=datetime.now() - timedelta(hours=13),
        )))


if __name__ == "__main__":
    unittest.main()
