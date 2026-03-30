import httpx
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class MeituanAPI:
    """美团 API 封装"""

    BASE_URL = "https://ordercenter.meituan.com"

    @staticmethod
    async def check_token_status(userid: str, token: str) -> dict:
        """检查 Token 状态"""
        url = f"{MeituanAPI.BASE_URL}/ordercenter/user/orders"
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
            "csecversion": "1.4.0"
        }

        headers = {
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
            "Content-Type": "application/json"
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, params=params, headers=headers, timeout=10.0)
                if response.status_code == 200:
                    return {"success": True, "code": response.json().get("code", -1)}
                return {"success": False, "code": -1, "message": f"HTTP {response.status_code}"}
        except Exception as e:
            logger.error(f"Check token status error: {e}")
            return {"success": False, "code": -1, "message": str(e)}

    @staticmethod
    async def get_order_list(userid: str, token: str, offset: int = 0, limit: int = 20, status_filter: int = 0) -> dict:
        """获取订单列表"""
        url = f"{MeituanAPI.BASE_URL}/ordercenter/user/orders"
        params = {
            "userid": userid,
            "token": token,
            "offset": offset,
            "limit": limit,
            "platformid": 6,
            "statusFilter": status_filter,  # 0=全部, 2=待使用
            "version": 0,
            "yodaReady": "wx",
            "csecappid": "wxde8ac0a21135c07d",
            "csecplatform": 3,
            "csecversionname": "9.25.105",
            "csecversion": "1.4.0"
        }

        headers = {
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
            "Content-Type": "application/json"
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, params=params, headers=headers, timeout=10.0)

                # 检测风控状态码
                if response.status_code == 418:
                    return {"success": False, "message": "HTTP 418 - 风控拦截", "is_wind_control": True}

                if response.status_code == 200:
                    return {"success": True, "data": response.json()}
                return {"success": False, "message": f"HTTP {response.status_code}"}
        except Exception as e:
            logger.error(f"Get order list error: {e}")
            return {"success": False, "message": str(e)}

    @staticmethod
    async def get_order_rebate_info(order_view_id: str, token: str, userid: str, **auth_params) -> dict:
        """获取订单返利信息（需要签名）"""
        # This would require the signature service
        # Placeholder for now
        return {"success": False, "message": "Not implemented"}
