"""Build a fresh, realistic `wechatFingerprint` fully offline.

Produces the exact `_n` device-data object jsguard collects (with the volatile keys
that finger.g strips already omitted), generates a local device id via the ported
`An()` algorithm, then encrypts with the recovered AES-128-CBC key/iv.

Nothing here talks to the network or the mini-program; it is a pure local port.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import time
import zlib

from finger_local import encode_fingerprint

FPV = "2.5.0"  # jsguard Ve.ver
DEFAULT_APP = "wxde8ac0a21135c07d"
# WeChat openid: "o" + 27 alnum chars, e.g. oJVP50DRAdtKlPFyi66xw2Uw03Is
_OPENID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"


def _md5_hex(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def _crc32_str(s: str) -> int:
    # jsguard mt.str == standard CRC-32 (poly 0xEDB88320) over UTF-8 bytes
    return zlib.crc32(s.encode("utf-8")) & 0xFFFFFFFF


def _rand7() -> str:
    # port of An(): 7 chars, each = String.fromCharCode( floor(random*25) | 65 )
    lo, hi = ord("A"), ord("Z")
    out = []
    for _ in range(7):
        out.append(chr(int(random.random() * (hi - lo)) | lo))
    return "".join(out)


def gen_openid() -> str:
    """Random openid matching WeChat format: o + 27 [A-Za-z0-9] (total 28)."""
    return "o" + "".join(random.choices(_OPENID_ALPHABET, k=27))


def gen_localid(system: dict, ext: list, union_id: str = "", now_ms: int | None = None) -> tuple[str, int]:
    """Port of jsguard An(): returns (localId, filetime_ms)."""
    f = now_ms if now_ms is not None else int(time.time() * 1000)
    s = _rand7()
    n = {
        "language": system.get("language", ""),
        "system": system,
        "ext": ext,
        "unionId": union_id,
    }
    core = f"{f}{s}{_md5_hex(json.dumps(n, ensure_ascii=False, separators=(',', ':')))}"
    tail = str(_crc32_str(core))[:4]
    return core + tail, f


def default_system(*, appid: str = "", scene: int = 1256, host_appid: str = "wxd7f003a9a2679061",
                   wx_version: str = "4.1.12.24", sdk_version: str = "3.17.0") -> dict:
    ts = int(time.time() * 1000)
    launch = {
        "path": "index/pages/mt/mt",
        "query": {},
        "scene": scene,
        "referrerInfo": {},
        "sessionId": f"hash={random.randint(1, 10**9)}&ts={ts}&host={host_appid}&version=25297&device=37",
        "apiCategory": "default",
    }
    storage = {"currentSize": 1028, "errMsg": "getStorageInfo:ok", "keys": [], "limitSize": 10000}
    battery = {"errMsg": "getBatteryInfo:ok", "isCharging": True, "level": 100}
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
        "version": wx_version,
        "SDKVersion": sdk_version,
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
        "LaunchOptionsSync": json.dumps(launch, ensure_ascii=False, separators=(",", ":")),
        "networkType": "wifi",
        "StorageInfo": json.dumps(storage, ensure_ascii=False, separators=(",", ":")),
        "compass": [],
        "accelerometer": [],
        "BatteryInfo": json.dumps(battery, ensure_ascii=False, separators=(",", ":")),
    }


def build_device_data(*, app: str = DEFAULT_APP, openid: str = "", unionid: str = "", dfpid: str = "",
                       latitude: float = 35.30323, longitude: float = 113.92675,
                       ext: list | None = None) -> dict:
    ext = ext if ext is not None else [0, 1, 2, 1, 4]
    system = default_system(appid=app)
    localid, filetime = gen_localid(system, ext, unionid)
    now_s = int(time.time())
    return {
        "system": system,
        "fpv": FPV,
        "timestamp": now_s,
        "app": app,
        "openid": openid or gen_openid(),
        "dfpid": dfpid or localid,  # server-assigned dfpid if known, else fall back to localid
        "localid": localid,
        "filetime": filetime,
        "reportTick": 1,
        "location": {
            "errMsg": "getLocation:ok",
            "latitude": latitude,
            "longitude": longitude,
            "getLocationType": "WX",
            "timeId": int(time.time() * 1000),
            "_factitious": True,
        },
    }


def main():
    ap = argparse.ArgumentParser(description="Generate a wechatFingerprint offline")
    ap.add_argument("--app", default=DEFAULT_APP, help=f"mini-program appId (default: {DEFAULT_APP})")
    ap.add_argument("--openid", default="", help="omit to random-generate o+27 alnum (28 chars)")
    ap.add_argument("--unionid", default="")
    ap.add_argument("--dfpid", default="", help="server-assigned dfpid; omit to use localid")
    ap.add_argument("--lat", type=float, default=35.30323)
    ap.add_argument("--lng", type=float, default=113.92675)
    args = ap.parse_args()

    data = build_device_data(
        app=args.app, openid=args.openid, unionid=args.unionid,
        dfpid=args.dfpid, latitude=args.lat, longitude=args.lng,
    )
    fp = encode_fingerprint(data)
    print(fp)


if __name__ == "__main__":
    main()
