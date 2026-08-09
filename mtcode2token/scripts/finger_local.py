"""Pure-local implementation of Meituan mini-program `wechatFingerprint` (jsguard finger.g).

Reversed from npm/@mtfe/wx-jsguard/dist/jsguard.js.

Algorithm:
    wechatFingerprint = PREFIX + base64( AES-128-CBC-PKCS7( KEY, IV, JSON.stringify(deviceData) ) )

Constants (decoded from the obfuscated string table, see decode_constants.py):
    PREFIX = "WX__ver1.2.0_CCCC_"
    KEY    = b"z7Jut6Ywr2Pe5Nhx"   (16 bytes, ASCII)
    IV     = b"0807060504030201"   (16 bytes, ASCII)

`deviceData` is the object built by jsguard's collector (`_n`) with a fixed set of
volatile keys removed (see finger.g). Because the cipher/key/iv are fixed, any well
formed JSON payload encrypts to a valid fingerprint the server accepts; supply a
realistic device profile to look legitimate.
"""
from __future__ import annotations

import base64
import json
from typing import Any

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

PREFIX = "WX__ver1.2.0_CCCC_"
KEY = b"z7Jut6Ywr2Pe5Nhx"
IV = b"0807060504030201"


def _pkcs7_pad(data: bytes, block: int = 16) -> bytes:
    pad = block - (len(data) % block)  # 1..16 (full block when already aligned)
    return data + bytes([pad]) * pad


def _pkcs7_unpad(data: bytes) -> bytes:
    pad = data[-1]
    if pad < 1 or pad > 16:
        raise ValueError(f"bad padding {pad}")
    return data[:-pad]


def aes_cbc_encrypt(plaintext: bytes, key: bytes = KEY, iv: bytes = IV) -> bytes:
    enc = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    return enc.update(_pkcs7_pad(plaintext)) + enc.finalize()


def aes_cbc_decrypt(ciphertext: bytes, key: bytes = KEY, iv: bytes = IV) -> bytes:
    dec = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    return _pkcs7_unpad(dec.update(ciphertext) + dec.finalize())


def encode_fingerprint(device_data: Any) -> str:
    """device_data: dict (or pre-serialized str) matching jsguard's cleaned `_n` object."""
    if isinstance(device_data, (bytes, bytearray)):
        payload = bytes(device_data)
    elif isinstance(device_data, str):
        payload = device_data.encode("utf-8")
    else:
        # match JS JSON.stringify: no spaces, unicode kept as-is (ensure_ascii=False)
        payload = json.dumps(device_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ct = aes_cbc_encrypt(payload)
    return PREFIX + base64.b64encode(ct).decode("ascii")


def decode_fingerprint(fp: str) -> str:
    """Inverse: recover the plaintext JSON string from a fingerprint."""
    if not fp.startswith(PREFIX):
        raise ValueError("missing prefix")
    b64 = fp[len(PREFIX):]
    ct = base64.b64decode(b64)
    return aes_cbc_decrypt(ct).decode("utf-8")


if __name__ == "__main__":
    sample = {"hello": "world", "n": 123}
    fp = encode_fingerprint(sample)
    print("fp     :", fp)
    print("decoded:", decode_fingerprint(fp))
