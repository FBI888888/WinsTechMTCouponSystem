from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.services.native_fingerprint import MEITUAN_APPID


LOGIN_URL = "https://open.meituan.com/user/v2/weappgetmobilelogin"
LOGIN_QUERY = {
    "sdkVersion": "4.1.12.24",
    "utm_medium": "windows",
    "joinkey": "100279_-937826947",
    "sdkType": "wxmp",
    "login_sdk_version": "6.19.1",
    "appName": "group",
    "risk_app": 214,
    "risk_partner": 0,
    "risk_platform": 13,
    "risk_smsPrefixId": 0,
    "risk_smsTemplateId": 0,
    "version_name": "10.31.200",
    "token_id": "HC3-vUFvZKJtclV_m8PODw",
}
LOGIN_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 "
    "MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI "
    "MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) "
    "UnifiedPCWindowsWechat(0xf2541c18) XWEB/25297"
)


class MeituanNativeLoginError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class NativeMeituanCredential:
    user_id: str
    token: str
    open_id: str
    open_id_cipher: str
    union_id: str
    union_id_cipher: str


async def exchange_native_credential(
    *, mini_program_code: str, phone_payload: dict[str, Any], wechat_fingerprint: str, login_uuid: str
) -> NativeMeituanCredential:
    # phone_payload["code"] is intentionally ignored: it is not wx.login's code.
    iv = str(phone_payload.get("iv") or "").strip()
    encrypted_data = str(phone_payload.get("encryptedData") or phone_payload.get("encrypted_data") or "").strip()
    if not iv or not encrypted_data:
        raise MeituanNativeLoginError("PHONE_PAYLOAD_INCOMPLETE", "手机号结果缺少 iv 或 encryptedData")
    if not str(mini_program_code or "").strip():
        raise MeituanNativeLoginError("MINI_PROGRAM_CODE_MISSING", "取码结果中没有小程序 code")

    params = {**LOGIN_QUERY, "uuid": login_uuid}
    form = {
        "iv": iv,
        "code": str(mini_program_code).strip(),
        "encryptedData": encrypted_data,
        "wechatFingerprint": wechat_fingerprint,
        "device_type": "microsoft",
        "device_os": "微信小程序",
    }
    headers = {
        "User-Agent": LOGIN_USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "mtgsig": "",
        "xweb_xhr": "1",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "Referer": f"https://servicewechat.com/{MEITUAN_APPID}/1563/page-frame.html",
        "Accept-Language": "zh-CN,zh;q=0.9",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=8.0), follow_redirects=True) as client:
            response = await client.post(LOGIN_URL, params=params, data=form, headers=headers)
    except httpx.TimeoutException as exc:
        raise MeituanNativeLoginError("MEITUAN_LOGIN_TIMEOUT", "美团登录请求超时，请重新获取凭据") from exc
    except httpx.HTTPError as exc:
        raise MeituanNativeLoginError("MEITUAN_LOGIN_UNAVAILABLE", "无法连接美团登录接口") from exc

    try:
        payload = response.json()
    except ValueError as exc:
        raise MeituanNativeLoginError("MEITUAN_BAD_RESPONSE", "美团登录接口返回了无效响应") from exc
    if response.status_code >= 400:
        raise MeituanNativeLoginError("MEITUAN_LOGIN_HTTP_ERROR", f"美团登录请求失败（HTTP {response.status_code}）")
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        message = str(payload.get("message") or payload.get("msg") or "美团登录响应缺少 data") if isinstance(payload, dict) else "美团登录响应格式错误"
        raise MeituanNativeLoginError("MEITUAN_LOGIN_REJECTED", message[:300])

    user_id = str(data.get("userId") or "").strip()
    token = str(data.get("token") or "").strip()
    open_id = str(data.get("openId") or "").strip()
    open_id_cipher = str(data.get("openIdCipher") or "").strip()
    union_id = str(data.get("unionId") or "").strip()
    union_id_cipher = str(data.get("unionIdCipher") or "").strip()
    if not all((user_id, token, open_id, open_id_cipher, union_id, union_id_cipher)):
        raise MeituanNativeLoginError(
            "MEITUAN_CREDENTIAL_INCOMPLETE",
            "美团登录响应缺少 token、userId、openId 或必要的 cipher/unionId 字段",
        )
    return NativeMeituanCredential(
        user_id=user_id,
        token=token,
        open_id=open_id,
        open_id_cipher=open_id_cipher,
        union_id=union_id,
        union_id_cipher=union_id_cipher,
    )
