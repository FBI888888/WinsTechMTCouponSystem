"""
Token 加密工具
用于敏感信息的加密存储
"""
import base64
import os
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from app.config import settings


class TokenEncryption:
    """Token 加密器"""

    _instance = None
    _fernet = None
    _initialized = False

    def __new__(cls):
        """单例模式，确保全局只有一个实例"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def _init_fernet(self):
        """初始化 Fernet（仅执行一次）"""
        if self._initialized:
            return
        
        self._initialized = True
        
        if not settings.TOKEN_ENCRYPTION_ENABLED:
            self._fernet = None
            return
            
        key = settings.ENCRYPTION_KEY
        if not key:
            key = self._derive_key_from_secret(settings.SECRET_KEY)
        else:
            if len(key) < 32:
                key = self._derive_key_from_secret(key)

        self._fernet = Fernet(key)

    def _derive_key_from_secret(self, secret: str) -> bytes:
        """从密钥字符串派生 Fernet 密钥"""
        salt = b'WinsTechMT_Salt_'
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=10000,  # 减少迭代次数，从 100000 降到 10000
        )
        key = base64.urlsafe_b64encode(kdf.derive(secret.encode()))
        return key

    def encrypt(self, plain_text: str) -> str:
        """
        加密字符串
        """
        if not plain_text:
            return ""

        if not settings.TOKEN_ENCRYPTION_ENABLED:
            return plain_text

        try:
            self._init_fernet()
            if self._fernet is None:
                return plain_text
            encrypted = self._fernet.encrypt(plain_text.encode())
            return encrypted.decode()
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Token encryption failed: {e}")
            return plain_text

    def decrypt(self, encrypted_text: str) -> str:
        """
        解密字符串
        """
        if not encrypted_text:
            return ""

        if not settings.TOKEN_ENCRYPTION_ENABLED:
            return encrypted_text

        try:
            self._init_fernet()
            if self._fernet is None:
                return encrypted_text
            decrypted = self._fernet.decrypt(encrypted_text.encode())
            return decrypted.decode()
        except Exception as e:
            import logging
            logging.getLogger(__name__).debug(f"Token decryption failed (may be unencrypted): {e}")
            return encrypted_text

    def is_encrypted(self, text: str) -> bool:
        """检查字符串是否已加密"""
        if not text:
            return False

        if not settings.TOKEN_ENCRYPTION_ENABLED:
            return False

        try:
            self._init_fernet()
            if self._fernet is None:
                return False
            self._fernet.decrypt(text.encode())
            return True
        except Exception:
            return False


# 全局加密器实例
token_encryption = TokenEncryption()


def encrypt_token(token: str) -> str:
    """加密 Token（便捷函数）"""
    if not settings.TOKEN_ENCRYPTION_ENABLED:
        return token
    return token_encryption.encrypt(token)


def decrypt_token(encrypted_token: str) -> str:
    """解密 Token（便捷函数）"""
    if not settings.TOKEN_ENCRYPTION_ENABLED:
        return encrypted_token
    return token_encryption.decrypt(encrypted_token)
