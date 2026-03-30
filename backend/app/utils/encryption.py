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

    def __init__(self):
        self._fernet = None

    def _get_fernet(self) -> Fernet:
        """获取 Fernet 实例（延迟初始化）"""
        if self._fernet is None:
            key = settings.ENCRYPTION_KEY
            if not key:
                # 如果没有配置密钥，生成一个基于 SECRET_KEY 的密钥
                key = self._derive_key_from_secret(settings.SECRET_KEY)
            else:
                # 确保 key 是正确格式
                if len(key) < 32:
                    key = self._derive_key_from_secret(key)

            self._fernet = Fernet(key)
        return self._fernet

    def _derive_key_from_secret(self, secret: str) -> bytes:
        """从密钥字符串派生 Fernet 密钥"""
        # 使用 PBKDF2 派生密钥
        salt = b'WinsTechMT_Salt_'  # 固定盐值（生产环境应该使用随机盐并存储）
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(secret.encode()))
        return key

    def encrypt(self, plain_text: str) -> str:
        """
        加密字符串
        Args:
            plain_text: 明文字符串
        Returns:
            加密后的字符串（Base64编码）
        """
        if not plain_text:
            return ""

        if not settings.TOKEN_ENCRYPTION_ENABLED:
            return plain_text

        try:
            fernet = self._get_fernet()
            encrypted = fernet.encrypt(plain_text.encode())
            return encrypted.decode()
        except Exception as e:
            # 加密失败时返回原文（记录日志）
            import logging
            logging.getLogger(__name__).warning(f"Token encryption failed: {e}")
            return plain_text

    def decrypt(self, encrypted_text: str) -> str:
        """
        解密字符串
        Args:
            encrypted_text: 加密后的字符串
        Returns:
            解密后的明文字符串
        """
        if not encrypted_text:
            return ""

        if not settings.TOKEN_ENCRYPTION_ENABLED:
            return encrypted_text

        try:
            fernet = self._get_fernet()
            decrypted = fernet.decrypt(encrypted_text.encode())
            return decrypted.decode()
        except Exception as e:
            # 解密失败时可能是因为数据未加密，返回原文
            import logging
            logging.getLogger(__name__).debug(f"Token decryption failed (may be unencrypted): {e}")
            return encrypted_text

    def is_encrypted(self, text: str) -> bool:
        """
        检查字符串是否已加密
        Args:
            text: 要检查的字符串
        Returns:
            True=已加密, False=未加密
        """
        if not text:
            return False

        try:
            fernet = self._get_fernet()
            fernet.decrypt(text.encode())
            return True
        except Exception:
            return False


# 全局加密器实例
token_encryption = TokenEncryption()


def encrypt_token(token: str) -> str:
    """加密 Token（便捷函数）"""
    return token_encryption.encrypt(token)


def decrypt_token(encrypted_token: str) -> str:
    """解密 Token（便捷函数）"""
    return token_encryption.decrypt(encrypted_token)
