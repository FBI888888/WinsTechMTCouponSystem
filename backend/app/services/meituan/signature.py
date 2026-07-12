import asyncio
import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


class SignatureService:
    """Backend-local mtgsig signer wrapper."""

    def __init__(self):
        self.node_path = "node"
        self.script_path = Path(__file__).with_name("mtgsig_standalone.js")

    def _build_request(self, order_view_id: str, token: str, userid: str, **kwargs) -> dict:
        latitude = str(kwargs.get("latitude") or kwargs.get("lat") or "41.748709")
        longitude = str(kwargs.get("longitude") or kwargs.get("lng") or "86.159215")
        city_id = str(kwargs.get("cityId") or "603")
        uuid = str(kwargs.get("uuid") or kwargs.get("csecuuid") or "c34d9b03-7520-47e3-9d7c-17a3d930c48d")
        open_id = str(kwargs.get("openId") or "")
        finger = str(kwargs.get("finger") or "582897vz66wv5u2xy55wx99z6yz4v54280y626y3xw29797833u146v1")
        is_gift = bool(order_view_id and (order_view_id[:1].isalpha() or len(order_view_id) > 20))

        url = (
            "https://apimobile.meituan.com/foodtrade/order/api/detail/preview"
            f"?duo_csdk_v=1&page_protocol_version=0001&pre_trace_id=&token={token}"
        )
        payload = {
            "pageQuery": {
                "cityId": city_id,
                "locCityId": city_id,
                "lat": latitude,
                "lng": longitude,
                "finger": finger,
                "orderId": None if is_gift else str(order_view_id),
                "giftId": str(order_view_id) if is_gift else None,
                "rcf_uniqueid": f"rcf-default-{kwargs.get('timestamp') or 'backend'}",
                "rcf_token": str(kwargs.get("rcf_token") or "5cac67121c9d446c8c2d7b93"),
                "programName": "mt",
                "mina_name": "mt-weapp",
                "openId": open_id,
                "token": token,
                "userId": userid,
                "uuid": uuid,
                "utmMedium": "WEIXINPROGRAM",
                "appVersion": "10.12.1",
                "envPlatform": "wx",
                "platform": "ANDROID",
                "uniPlatform": "windows",
            },
            "commonParams": {
                "location": {"lat": float(latitude), "lng": float(longitude), "accuracy": 0},
                "userInfo": {
                    "userId": userid,
                    "token": token,
                    "uuid": uuid,
                    "openId": open_id,
                },
                "cityInfo": {"cityId": city_id, "locCityId": city_id},
                "fingerprint": {"fingerprint": finger},
                "systemInfo": {
                    "platform": "android",
                    "IS_MT": True,
                    "mpAppId": "wxde8ac0a21135c07d",
                    "mpAppVersion": "10.12.1",
                    "envPlatform": "wx",
                    "userAgent": kwargs.get(
                        "userAgent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 "
                        "MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI "
                        "MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) "
                        "UnifiedPCWindowsWechat(0xf254181d) XWEB/19201 miniProgram/wxde8ac0a21135c07d",
                    ),
                },
                "isPreview": True,
            },
            "prevData": {},
            "nodeDataMap": {},
            "updatePropMap": {},
            "payload": {},
            "cacheDynamicComponent": {"protocolVersion": "0001"},
            "pageId": str(kwargs.get("pageId") or "12299"),
            "pageProtocolId": str(kwargs.get("pageProtocolId") or "0340"),
            "minifyHttpResponse": "1",
        }
        payload["pageQuery"] = {k: v for k, v in payload["pageQuery"].items() if v is not None}
        return {
            "method": str(kwargs.get("method") or "POST").upper(),
            "url": kwargs.get("url") or url,
            "body": kwargs["body"] if "body" in kwargs else payload,
            "cookies": kwargs.get("cookies"),
            "fresh": kwargs.get("fresh", True),
            "maxReuse": kwargs.get("maxReuse", 100),
        }

    def sign(self, order_view_id: str, token: str, userid: str, **kwargs) -> dict:
        if not self.script_path.exists():
            raise FileNotFoundError(f"mtgsig_standalone.js not found at {self.script_path}")

        request = self._build_request(order_view_id, token, userid, **kwargs)
        node_code = (
            "const { sign } = require(process.argv[1]);"
            "const input = JSON.parse(process.argv[2]);"
            "const result = sign(input);"
            "process.stdout.write(JSON.stringify(result));"
        )

        try:
            result = subprocess.run(
                [self.node_path, "-e", node_code, str(self.script_path), json.dumps(request, ensure_ascii=False)],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or "node signer failed")
            return json.loads(result.stdout)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("signature timeout") from exc
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"signature result parse failed: {exc}") from exc
        except Exception as exc:
            logger.error("Signature error: %s", exc)
            raise

    async def async_sign(self, order_view_id: str, token: str, userid: str, **kwargs) -> dict:
        return await asyncio.to_thread(self.sign, order_view_id, token, userid, **kwargs)
