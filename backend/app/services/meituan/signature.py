import subprocess
import json
import os
import logging

logger = logging.getLogger(__name__)


class SignatureService:
    """签名服务 - 通过 Node.js 子进程调用 mtgsig.js"""

    def __init__(self):
        self.node_path = os.getenv("NODE_PATH", "node")
        # Path to mtgsig.js in the project
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        self.script_path = os.path.join(base_dir, "功能参考项目", "mtgsig.js")

    def sign(self, order_view_id: str, token: str, userid: str, **kwargs) -> dict:
        """
        调用 Node.js 执行签名

        Args:
            order_view_id: 订单视图ID
            token: 美团token
            userid: 美团userid
            **kwargs: 额外参数 (csecuuid, openId, openIdCipher)

        Returns:
            签名后的参数字典
        """
        if not os.path.exists(self.script_path):
            raise FileNotFoundError(f"mtgsig.js not found at {self.script_path}")

        # Prepare arguments
        args_json = json.dumps(kwargs)

        cmd = [self.node_path, self.script_path, order_view_id, token, userid, args_json]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode != 0:
                logger.error(f"Signature failed: {result.stderr}")
                raise Exception(f"签名失败: {result.stderr}")

            return json.loads(result.stdout)

        except subprocess.TimeoutExpired:
            raise Exception("签名超时")
        except json.JSONDecodeError as e:
            raise Exception(f"签名结果解析失败: {e}")
        except Exception as e:
            logger.error(f"Signature error: {e}")
            raise Exception(f"签名异常: {e}")

    async def async_sign(self, order_view_id: str, token: str, userid: str, **kwargs) -> dict:
        """异步调用签名"""
        import asyncio

        def _sync_sign():
            return self.sign(order_view_id, token, userid, **kwargs)

        return await asyncio.to_thread(_sync_sign)
