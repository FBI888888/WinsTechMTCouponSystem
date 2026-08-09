from __future__ import annotations

import base64
import hashlib
import json
import random
import string
import time
import zlib
from typing import Any

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


FINGERPRINT_PREFIX = "WX__ver1.2.0_CCCC_"
FINGERPRINT_KEY = b"z7Jut6Ywr2Pe5Nhx"
FINGERPRINT_IV = b"0807060504030201"
MEITUAN_APPID = "wxde8ac0a21135c07d"


def generate_lxcuid(user_agent: str = "", screen: str = "414*780") -> str:
    """Port of the LX SDK lxcuid generator used by the mini program."""
    rng = random.SystemRandom()

    def now_hex_spin() -> str:
        value = int(time.time() * 1000)
        spin = 0
        while spin < 200:
            current = int(time.time() * 1000)
            if current != value:
                value = current
                break
            spin += 1
        return format(value, "x") + format(spin, "x")

    def mix_ua(value: str) -> int:
        buffer: list[int] = []
        mixed = 0
        for char in value:
            buffer.insert(0, ord(char) & 255)
            if len(buffer) >= 4:
                chunk = sum(byte << (8 * index) for index, byte in enumerate(buffer))
                mixed ^= chunk
                buffer = []
        if buffer:
            mixed ^= sum(byte << (8 * index) for index, byte in enumerate(buffer))
        return mixed

    area = 0
    try:
        width, height = screen.split("*", 1)
        area = int(float(width) * float(height))
    except (ValueError, TypeError):
        pass
    random_digits = int(str(rng.random())[2:] or "0")
    return "-".join((
        now_hex_spin(),
        format(random_digits, "x"),
        format(mix_ua(user_agent), "x"),
        format(area, "x"),
        now_hex_spin(),
    ))


def _pad(value: bytes) -> bytes:
    size = 16 - len(value) % 16
    return value + bytes([size]) * size


def _unpad(value: bytes) -> bytes:
    if not value:
        raise ValueError("empty fingerprint payload")
    size = value[-1]
    if size < 1 or size > 16 or value[-size:] != bytes([size]) * size:
        raise ValueError("invalid fingerprint padding")
    return value[:-size]


def encode_fingerprint(device_data: Any) -> str:
    raw = (
        device_data.encode("utf-8")
        if isinstance(device_data, str)
        else json.dumps(device_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    encryptor = Cipher(algorithms.AES(FINGERPRINT_KEY), modes.CBC(FINGERPRINT_IV)).encryptor()
    encrypted = encryptor.update(_pad(raw)) + encryptor.finalize()
    return FINGERPRINT_PREFIX + base64.b64encode(encrypted).decode("ascii")


def decode_fingerprint(value: str) -> dict:
    if not value.startswith(FINGERPRINT_PREFIX):
        raise ValueError("invalid fingerprint prefix")
    encrypted = base64.b64decode(value[len(FINGERPRINT_PREFIX):], validate=True)
    decryptor = Cipher(algorithms.AES(FINGERPRINT_KEY), modes.CBC(FINGERPRINT_IV)).decryptor()
    raw = _unpad(decryptor.update(encrypted) + decryptor.finalize())
    return json.loads(raw.decode("utf-8"))


def _random_letters(rng: random.Random) -> str:
    # The original An() expression produces A..Y (not Z).
    return "".join(chr((int(rng.random() * 25)) | 65) for _ in range(7))


def _default_system(rng: random.Random, now_ms: int) -> dict[str, Any]:
    launch = {
        "path": "index/pages/mt/mt",
        "query": {},
        "scene": 1256,
        "referrerInfo": {},
        "sessionId": (
            f"hash={rng.randint(1, 10**9)}&ts={now_ms}&host=wxd7f003a9a2679061"
            "&version=25297&device=37"
        ),
        "apiCategory": "default",
    }
    storage = {"currentSize": 1028, "errMsg": "getStorageInfo:ok", "keys": [], "limitSize": 10000}
    battery = {"errMsg": "getBatteryInfo:ok", "isCharging": True, "level": 100}
    compact = lambda value: json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return {
        "brand": "microsoft",
        "model": "microsoft",
        "system": "Windows 10 x64",
        "platform": "windows",
        "benchmarkLevel": -1,
        "pixelRatio": 1,
        "screenWidth": 414,
        "screenHeight": 780,
        "windowWidth": 414,
        "windowHeight": 780,
        "statusBarHeight": 20,
        "safeArea": {"bottom": 780, "height": 780, "left": 0, "right": 414, "top": 0, "width": 414},
        "language": "zh_CN",
        "version": "4.1.12.24",
        "SDKVersion": "3.17.0",
        "theme": "light",
        "host": {"appId": "", "env": "WeChat"},
        "enableDebug": False,
        "bluetoothEnabled": False,
        "locationEnabled": True,
        "wifiEnabled": True,
        "albumAuthorized": True,
        "cameraAuthorized": True,
        "locationAuthorized": True,
        "microphoneAuthorized": True,
        "notificationAuthorized": True,
        "devicePixelRatio": 1,
        "errMsg": "getSystemInfo:ok",
        "brightness": 0.5,
        "LaunchOptionsSync": compact(launch),
        "networkType": "wifi",
        "StorageInfo": compact(storage),
        "compass": [],
        "accelerometer": [],
        "BatteryInfo": compact(battery),
    }


def build_account_fingerprint() -> str:
    """Build the cleaned jsguard device payload and encrypt it locally."""
    rng = random.SystemRandom()
    now_ms = int(time.time() * 1000)
    openid = "o" + "".join(rng.choice(string.ascii_letters + string.digits) for _ in range(27))
    system = _default_system(rng, now_ms)
    ext = [0, 1, 2, 1, 4]
    local_seed = json.dumps(
        {"language": system.get("language", ""), "system": system, "ext": ext, "unionId": ""},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    local_id = f"{now_ms}{_random_letters(rng)}{hashlib.md5(local_seed.encode()).hexdigest()}"
    local_id += str(zlib.crc32(local_id.encode()) & 0xFFFFFFFF)[:4]
    return encode_fingerprint({
        "system": system,
        "fpv": "2.5.0",
        "timestamp": int(time.time()),
        "app": MEITUAN_APPID,
        "openid": openid,
        "dfpid": local_id,
        "localid": local_id,
        "filetime": now_ms,
        "reportTick": 1,
        "location": {
            "errMsg": "getLocation:ok",
            "latitude": 35.30323,
            "longitude": 113.92675,
            "getLocationType": "WX",
            "timeId": now_ms,
            "_factitious": True,
        },
    })
