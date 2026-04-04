import asyncio
import logging

import httpx


logger = logging.getLogger(__name__)


class MeituanAPI:
    """美团 API 封装"""

    BASE_URL = "https://ordercenter.meituan.com"
    _client: httpx.AsyncClient | None = None
    _client_lock = asyncio.Lock()

    @classmethod
    async def _get_client(cls) -> httpx.AsyncClient:
        if cls._client is not None and not cls._client.is_closed:
            return cls._client

        async with cls._client_lock:
            if cls._client is not None and not cls._client.is_closed:
                return cls._client

            cls._client = httpx.AsyncClient(
                timeout=httpx.Timeout(10.0),
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
                headers={
                    "Host": "ordercenter.meituan.com",
                    "Connection": "keep-alive",
                    "User-Agent": "",
                    "xweb_xhr": "1",
                    "utm_medium": "",
                    "clientversion": "3.8.9",
                    "Accept": "*/*",
                    "Sec-Fetch-Site": "cross-site",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Dest": "empty",
                    "Referer": "https://servicewechat.com/wxde8ac0a21135c07d/1451/page-frame.html",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "Content-Type": "application/json",
                },
            )
            return cls._client

    @classmethod
    async def close(cls) -> None:
        if cls._client is None:
            return

        async with cls._client_lock:
            if cls._client is not None and not cls._client.is_closed:
                await cls._client.aclose()
            cls._client = None

    @classmethod
    async def _get(cls, params: dict) -> httpx.Response:
        client = await cls._get_client()
        return await client.get(f"{cls.BASE_URL}/ordercenter/user/orders", params=params)

    @classmethod
    async def check_token_status(cls, userid: str, token: str) -> dict:
        """检查 Token 状态"""
        params = {
            "userid": userid,
            "token": token,
            "offset": 0,
            "limit": 10,
            "platformid": 6,
            "statusFilter": 0,
            "version": 0,
            "yodaReady": "wx",
            "csecappid": "wxde8ac0a21135c07d",
            "csecplatform": 3,
            "csecversionname": "9.25.105",
            "csecversion": "1.4.0",
        }

        try:
            response = await cls._get(params)
            if response.status_code == 200:
                return {"success": True, "code": response.json().get("code", -1)}
            return {"success": False, "code": -1, "message": f"HTTP {response.status_code}"}
        except Exception as exc:
            logger.error("Check token status error: %s", exc)
            return {"success": False, "code": -1, "message": str(exc)}

    @classmethod
    async def get_order_list(
        cls,
        userid: str,
        token: str,
        offset: int = 0,
        limit: int = 20,
        status_filter: int = 0,
    ) -> dict:
        """获取订单列表"""
        params = {
            "userid": userid,
            "token": token,
            "offset": offset,
            "limit": limit,
            "platformid": 6,
            "statusFilter": status_filter,
            "version": 0,
            "yodaReady": "wx",
            "csecappid": "wxde8ac0a21135c07d",
            "csecplatform": 3,
            "csecversionname": "9.25.105",
            "csecversion": "1.4.0",
        }

        try:
            response = await cls._get(params)
            if response.status_code == 418:
                return {"success": False, "message": "HTTP 418 - 风控拦截", "is_wind_control": True}

            if response.status_code == 200:
                return {"success": True, "data": response.json()}
            return {"success": False, "message": f"HTTP {response.status_code}"}
        except Exception as exc:
            logger.error("Get order list error: %s", exc)
            return {"success": False, "message": str(exc)}

    @classmethod
    async def get_order_rebate_info(cls, order_view_id: str, token: str, userid: str, **auth_params) -> dict:
        """获取订单返利信息（需要签名）"""
        return {"success": False, "message": "Not implemented"}
