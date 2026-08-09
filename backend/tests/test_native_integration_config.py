import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.config import SystemConfig
from app.services.native_integration_config import (
    CONFIG_NATIVE_ENABLED,
    CONFIG_WXCODE_SERVICE_API_KEY,
    CONFIG_WXCODE_SERVICE_URL,
    NativeIntegrationRuntimeConfig,
    encrypt_native_api_key,
    load_native_integration_config,
    upsert_native_config,
)
from app.services.wxcode_client import WxcodeOpenAPIClient
from app.utils.encryption import token_encryption
from app.routers.native_integration import _config_response
from app.routers.settings import get_configs
from app.models.user import User


class NativeIntegrationConfigTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        SystemConfig.__table__.create(engine)
        self.db = sessionmaker(bind=engine)()
        self.original = {
            "NATIVE_ACCOUNT_ENABLED": settings.NATIVE_ACCOUNT_ENABLED,
            "WXCODE_SERVICE_URL": settings.WXCODE_SERVICE_URL,
            "WXCODE_SERVICE_API_KEY": settings.WXCODE_SERVICE_API_KEY,
            "TOKEN_ENCRYPTION_ENABLED": settings.TOKEN_ENCRYPTION_ENABLED,
            "ENCRYPTION_KEY": settings.ENCRYPTION_KEY,
        }
        settings.NATIVE_ACCOUNT_ENABLED = False
        settings.WXCODE_SERVICE_URL = "https://env-wxcode.test"
        settings.WXCODE_SERVICE_API_KEY = "env-key"
        settings.TOKEN_ENCRYPTION_ENABLED = True
        settings.ENCRYPTION_KEY = "stable-native-config-test-key"
        token_encryption._initialized = False
        token_encryption._fernet = None

    def tearDown(self):
        self.db.close()
        for key, value in self.original.items():
            setattr(settings, key, value)
        token_encryption._initialized = False
        token_encryption._fernet = None

    def test_environment_is_used_until_ui_settings_exist(self):
        value = load_native_integration_config(self.db)
        self.assertFalse(value.enabled)
        self.assertEqual(value.service_url, "https://env-wxcode.test")
        self.assertEqual(value.api_key, "env-key")
        self.assertEqual(value.api_key_source, "environment")

    def test_ui_settings_override_environment_and_secret_is_encrypted(self):
        encrypted_key = encrypt_native_api_key("ui-secret-key")
        self.assertNotEqual(encrypted_key, "ui-secret-key")
        upsert_native_config(
            self.db,
            key=CONFIG_NATIVE_ENABLED,
            value="true",
            config_type="boolean",
            description="enabled",
        )
        upsert_native_config(
            self.db,
            key=CONFIG_WXCODE_SERVICE_URL,
            value="https://ui-wxcode.test/",
            config_type="string",
            description="url",
        )
        upsert_native_config(
            self.db,
            key=CONFIG_WXCODE_SERVICE_API_KEY,
            value=encrypted_key,
            config_type="secret",
            description="key",
        )
        self.db.commit()

        value = load_native_integration_config(self.db)
        self.assertTrue(value.enabled)
        self.assertEqual(value.service_url, "https://ui-wxcode.test")
        self.assertEqual(value.api_key, "ui-secret-key")
        self.assertEqual(value.api_key_source, "database")
        stored = self.db.query(SystemConfig).filter(
            SystemConfig.config_key == CONFIG_WXCODE_SERVICE_API_KEY
        ).one()
        self.assertNotIn("ui-secret-key", stored.config_value)

    def test_default_client_uses_runtime_config_without_exposing_secret(self):
        runtime = NativeIntegrationRuntimeConfig(
            enabled=True,
            service_url="https://ui-wxcode.test",
            api_key="runtime-key",
            enabled_source="database",
            service_url_source="database",
            api_key_source="database",
        )
        with patch(
            "app.services.wxcode_client.load_native_integration_config",
            return_value=runtime,
        ):
            client = WxcodeOpenAPIClient()
        self.assertTrue(client.enabled)
        self.assertEqual(client.base_url, "https://ui-wxcode.test")
        self.assertEqual(client.api_key, "runtime-key")
        response = _config_response(runtime).model_dump()
        self.assertNotIn("api_key", response)
        self.assertTrue(response["api_key_configured"])

    def test_generic_settings_listing_excludes_native_config(self):
        self.db.add(SystemConfig(
            config_key=CONFIG_WXCODE_SERVICE_API_KEY,
            config_value="encrypted-value",
            config_type="secret",
            category="native_integration",
        ))
        self.db.add(SystemConfig(
            config_key="scan_interval",
            config_value="30",
            config_type="number",
            category="scan",
        ))
        self.db.commit()
        rows = get_configs(db=self.db, current_user=User(id=1, role="admin"))
        self.assertEqual([row.config_key for row in rows], ["scan_interval"])


if __name__ == "__main__":
    unittest.main()
