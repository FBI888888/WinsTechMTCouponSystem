"""Assemble weappgetmobilelogin params (excluding mtgsig).

Param provenance (reversed from Meituan miniapp appservice / account-ext):
- Static config in account SDK: token_id, joinkey, risk_*, appName, version_name, appId
- uuid: LX SDK lxcuid (persisted); see generate_lxcuid()
- code: wx.login() temporary code (WeChat-side, not local-algo)
- iv / encryptedData: wx.getPhoneNumber button event.detail (WeChat-side)
- wechatFingerprint: jsguard.finger.g() => "WX__ver1.2.0_..." (device fingerprint SDK)
- device_type: sysInfo.model mapped (Windows WeChat => microsoft)
- device_os: hardcoded "微信小程序"
- Query sdkVersion/utm_medium/login_sdk_version/sdkType from SDK/sysInfo
"""
from __future__ import annotations

import json
import math
import random
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

# Observed from runtime getSdkConfig / baseline account.config
DEFAULT_ACCOUNT_CONFIG = {
    "env": "prod",
    "appName": "group",
    "appId": "wxde8ac0a21135c07d",
    "joinkey": "100279_-937826947",
    "token_id": "HC3-vUFvZKJtclV_m8PODw",
    "risk_app": 214,
    "risk_platform": 13,
    "risk_partner": 0,
    "risk_smsTemplateId": 0,
    "risk_smsPrefixId": 0,
    "version_name": "10.31.200",
    "sdkVersion": "4.1.12.24",  # appears as query sdkVersion (wxVersion field naming in builder)
    "login_sdk_version": "6.19.1",
    "sdkType": "wxmp",
}


def generate_lxcuid(ua: str = "", screen: str = "") -> str:
    """Port of LX SDK lxcuid generator (from appservice bundle).

    Format: hex(ts+spin)-random-uaHash-screenArea-hex(ts+spin)
    Persisted by the app as storage key `uuid` / lx storageData.lxcuid.
    """

    def now_hex_spin() -> str:
        t = int(time.time() * 1000)
        e = 0
        # busy-wait equivalent not needed for offline generation; emulate uniqueness
        while e < 200:
            n = int(time.time() * 1000)
            if n != t:
                t = n
                break
            e += 1
        return format(t, "x") + format(e, "x")

    def mix_ua(ua_str: str) -> int:
        s: list[int] = []
        u = 0

        def l(acc: int, buf: list[int]) -> int:
            a = 0
            for n, b in enumerate(buf):
                a |= b << (8 * n)
            return acc ^ a

        for ch in ua_str:
            s.insert(0, ord(ch) & 255)
            if len(s) >= 4:
                u = l(u, s)
                s = []
        if s:
            u = l(u, s)
        return u

    o = int(str(random.random())[2:] or "0")
    c = mix_ua(ua or "")
    f = 0
    if screen and "*" in screen:
        w, h = screen.split("*", 1)
        try:
            f = int(float(w) * float(h))
        except ValueError:
            f = 0
    parts = [now_hex_spin(), o, c, f, now_hex_spin()]
    return "-".join(format(int(p), "x") if isinstance(p, int) else str(p) for p in parts)


@dataclass
class LoginBody:
    iv: str
    code: str
    encryptedData: str
    wechatFingerprint: str
    device_type: str = "microsoft"
    device_os: str = "微信小程序"


@dataclass
class LoginQuery:
    sdkVersion: str
    utm_medium: str
    joinkey: str
    sdkType: str
    login_sdk_version: str
    appName: str
    risk_app: int
    risk_partner: int
    risk_platform: int
    risk_smsPrefixId: int
    risk_smsTemplateId: int
    version_name: str
    token_id: str
    uuid: str


def build_query(
    uuid: str,
    platform: str = "windows",
    cfg: dict[str, Any] | None = None,
) -> LoginQuery:
    c = {**DEFAULT_ACCOUNT_CONFIG, **(cfg or {})}
    return LoginQuery(
        sdkVersion=str(c["sdkVersion"]),
        utm_medium=platform,
        joinkey=str(c["joinkey"]),
        sdkType=str(c["sdkType"]),
        login_sdk_version=str(c["login_sdk_version"]),
        appName=str(c["appName"]),
        risk_app=int(c["risk_app"]),
        risk_partner=int(c["risk_partner"]),
        risk_platform=int(c["risk_platform"]),
        risk_smsPrefixId=int(c["risk_smsPrefixId"]),
        risk_smsTemplateId=int(c["risk_smsTemplateId"]),
        version_name=str(c["version_name"]),
        token_id=str(c["token_id"]),
        uuid=uuid,
    )


def build_url(query: LoginQuery, base: str = "https://open.meituan.com/user/v2/weappgetmobilelogin") -> str:
    return f"{base}?{urlencode(asdict(query))}"


def build_form(body: LoginBody) -> str:
    return urlencode(asdict(body))


def build_request(
    *,
    code: str,
    iv: str,
    encryptedData: str,
    wechatFingerprint: str,
    uuid: str | None = None,
    device_type: str = "microsoft",
    platform: str = "windows",
    cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build full request pieces. mtgsig intentionally omitted (optional / already reversed by user)."""
    q = build_query(uuid or generate_lxcuid(), platform=platform, cfg=cfg)
    b = LoginBody(
        iv=iv,
        code=code,
        encryptedData=encryptedData,
        wechatFingerprint=wechatFingerprint,
        device_type=device_type,
        device_os="微信小程序",
    )
    return {
        "method": "POST",
        "url": build_url(q),
        "headers": {
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": f"https://servicewechat.com/{DEFAULT_ACCOUNT_CONFIG['appId']}/page-frame.html",
        },
        "query": asdict(q),
        "body": asdict(b),
        "form": build_form(b),
        "notes": {
            "mtgsig": "skipped (optional)",
            "code_iv_encryptedData": "must come from WeChat wx.login + getPhoneNumber",
            "wechatFingerprint": "must come from jsguard.finger.g (or captured runtime value)",
        },
    }


if __name__ == "__main__":
    # demo with placeholders; real values from capture when available
    cap = Path(__file__).resolve().parents[1] / "captures" / "login_decoded.json"
    if cap.exists():
        data = json.loads(cap.read_text(encoding="utf-8"))
        body = data["body"]
        query = data["query"]
        req = build_request(
            code=body["code"],
            iv=body["iv"],
            encryptedData=body["encryptedData"],
            wechatFingerprint=body["wechatFingerprint"],
            uuid=query.get("uuid"),
            device_type=body.get("device_type", "microsoft"),
            platform=query.get("utm_medium", "windows"),
        )
        out = Path(__file__).resolve().parents[1] / "captures" / "rebuilt_request.json"
        out.write_text(json.dumps(req, ensure_ascii=False, indent=2), encoding="utf-8")
        print("rebuilt", out)
        print("url match query keys ok", set(req["query"]) == set(query))
    else:
        print(json.dumps(build_request(
            code="CODE",
            iv="IV",
            encryptedData="ED",
            wechatFingerprint="WX__ver1.2.0_...",
        ), ensure_ascii=False, indent=2))
