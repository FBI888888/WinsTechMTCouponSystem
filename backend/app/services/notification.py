"""
通知服务模块
- 微信消息通知
- 支持账号风控、失效等异常情况的提醒
"""
import logging
import aiohttp
from typing import Optional
from sqlalchemy.orm import Session
from app.models.config import SystemConfig

logger = logging.getLogger(__name__)

# 微信消息接口配置
WECHAT_API_URL = "http://home.jhsrvip.cn:7777/send_text"

# 配置项Key
CONFIG_WECHAT_FROM_WXID = "wechat_from_wxid"
CONFIG_WECHAT_TO_WXID = "wechat_to_wxid"
CONFIG_WECHAT_ENABLED = "wechat_notification_enabled"


class WechatNotifier:
    """微信消息通知器"""

    def __init__(self, db: Session):
        self.db = db
        self._config_cache = {}

    def _get_config(self, key: str, default: str = "") -> str:
        """获取系统配置"""
        if key in self._config_cache:
            return self._config_cache[key]

        config = self.db.query(SystemConfig).filter(SystemConfig.config_key == key).first()
        value = config.config_value if config and config.config_value else default
        self._config_cache[key] = value
        return value

    def _is_enabled(self) -> bool:
        """检查微信通知是否启用"""
        enabled = self._get_config(CONFIG_WECHAT_ENABLED, "false")
        return enabled.lower() == "true"

    async def send_message(self, content: str) -> bool:
        """
        发送微信文本消息

        Args:
            content: 消息内容

        Returns:
            True=发送成功, False=发送失败
        """
        if not self._is_enabled():
            logger.debug("[微信通知] 微信通知未启用，跳过发送")
            return False

        from_wxid = self._get_config(CONFIG_WECHAT_FROM_WXID, "")
        to_wxid = self._get_config(CONFIG_WECHAT_TO_WXID, "")

        if not from_wxid or not to_wxid:
            logger.warning("[微信通知] 未配置from_wxid或to_wxid，无法发送消息")
            return False

        payload = {
            "from_wxid": from_wxid,
            "to_wxid": to_wxid,
            "content": content
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    WECHAT_API_URL,
                    json=payload,
                    headers={
                        "Content-Type": "application/json",
                        "User-Agent": "WinsTechMTCouponSystem/1.0",
                        "Accept": "*/*"
                    },
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        logger.info(f"[微信通知] 消息发送成功: {result}")
                        return True
                    else:
                        text = await response.text()
                        logger.error(f"[微信通知] 消息发送失败，状态码: {response.status}, 响应: {text}")
                        return False
        except aiohttp.ClientError as e:
            logger.error(f"[微信通知] 网络请求失败: {e}")
            return False
        except Exception as e:
            logger.error(f"[微信通知] 发送消息时发生错误: {e}")
            return False

    async def notify_account_wind_control(self, remark: str, userid: str) -> bool:
        """
        发送账号风控通知

        Args:
            remark: 账号备注
            userid: 用户ID

        Returns:
            True=发送成功, False=发送失败
        """
        content = (
            f"⚠️ 美团券码系统 - 账号风控提醒\n"
            f"━━━━━━━━━━━━━━━\n"
            f"账号备注: {remark or '未设置'}\n"
            f"用户ID: {userid}\n"
            f"状态: 触发风控（418）\n"
            f"━━━━━━━━━━━━━━━\n"
            f"请检查该账号状态，可能需要更换Token或稍后重试。"
        )
        return await self.send_message(content)

    async def notify_account_invalid(self, remark: str, userid: str) -> bool:
        """
        发送账号失效通知

        Args:
            remark: 账号备注
            userid: 用户ID

        Returns:
            True=发送成功, False=发送失败
        """
        content = (
            f"❌ 美团券码系统 - 账号失效提醒\n"
            f"━━━━━━━━━━━━━━━\n"
            f"账号备注: {remark or '未设置'}\n"
            f"用户ID: {userid}\n"
            f"状态: Token已失效\n"
            f"━━━━━━━━━━━━━━━\n"
            f"请尽快更新该账号的Token信息。"
        )
        return await self.send_message(content)

    async def notify_batch_wind_control(self, count: int) -> bool:
        """
        发送批量风控停止通知

        Args:
            count: 连续风控的账号数量

        Returns:
            True=发送成功, False=发送失败
        """
        content = (
            f"🛑 美团券码系统 - 扫描任务暂停\n"
            f"━━━━━━━━━━━━━━━\n"
            f"原因: 连续{count}个账号触发风控\n"
            f"━━━━━━━━━━━━━━━\n"
            f"定时扫描任务已自动暂停，请检查账号状态或稍后重试。"
        )
        return await self.send_message(content)


async def send_wechat_notification(db: Session, notification_type: str, **kwargs) -> bool:
    """
    发送微信通知的便捷函数

    Args:
        db: 数据库会话
        notification_type: 通知类型 ('wind_control', 'invalid', 'batch_wind_control')
        **kwargs: 其他参数

    Returns:
        True=发送成功, False=发送失败
    """
    notifier = WechatNotifier(db)

    if notification_type == "wind_control":
        return await notifier.notify_account_wind_control(
            kwargs.get("remark", ""),
            kwargs.get("userid", "")
        )
    elif notification_type == "invalid":
        return await notifier.notify_account_invalid(
            kwargs.get("remark", ""),
            kwargs.get("userid", "")
        )
    elif notification_type == "batch_wind_control":
        return await notifier.notify_batch_wind_control(
            kwargs.get("count", 0)
        )
    else:
        logger.warning(f"[微信通知] 未知的通知类型: {notification_type}")
        return False
