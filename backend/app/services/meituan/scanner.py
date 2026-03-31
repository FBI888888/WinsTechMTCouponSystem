"""
定时任务服务
- 定时扫描账号订单和券码
- 检查账号有效性
- 记录任务日志
"""
import asyncio
import logging
import json
import os
from datetime import datetime
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import and_

from app.database import SessionLocal
from app.models.account import MTAccount, AccountStatus
from app.models.order import Order
from app.models.coupon import Coupon
from app.models.log import ScheduledTaskLog
from app.models.config import SystemConfig
from app.config import settings
from app.utils.encryption import decrypt_token
from app.services.notification import send_wechat_notification

logger = logging.getLogger(__name__)


def get_decrypted_token(account: MTAccount) -> str:
    """获取账号的解密Token"""
    return decrypt_token(account.token)


class ScheduledTaskService:
    """定时任务服务"""

    def __init__(self):
        self.request_interval = settings.SCAN_REQUEST_INTERVAL
        self.node_path = os.getenv("NODE_PATH", "node")
        base_dir = os.path.dirname(os.path.abspath(__file__))
        self.script_path = os.path.join(base_dir, "meituanBackendApi.cjs")

    async def check_account_validity(self, account: MTAccount) -> bool:
        """
        检查账号Token有效性
        Returns:
            True=有效, False=无效
        """
        try:
            from app.services.meituan.api import MeituanAPI
            token = get_decrypted_token(account)
            result = await MeituanAPI.check_token_status(account.userid, token)
            code = result.get("code", -1)
            return code == 0
        except Exception as e:
            logger.error(f"Check account {account.userid} validity error: {e}")
            return False

    async def get_pending_orders(self, account: MTAccount, status_filter: int = 2) -> tuple:
        """
        获取账号的订单列表
        status_filter: 0=全部, 2=待使用, 3=已完成, 4=退款/售后
        Returns:
            (orders, is_wind_control) 元组
        """
        WC_MAX_RETRIES = 3
        WC_WAIT_SECONDS = 10

        for attempt in range(1, WC_MAX_RETRIES + 1):
            try:
                from app.services.meituan.api import MeituanAPI
                token = get_decrypted_token(account)
                result = await MeituanAPI.get_order_list(
                    userid=account.userid,
                    token=token,
                    offset=0,
                    limit=100,
                    status_filter=status_filter
                )

                # 检测风控（通过API返回的标志或HTTP状态码判断）
                if not result.get("success"):
                    # API层已检测到风控
                    if result.get("is_wind_control"):
                        if attempt < WC_MAX_RETRIES:
                            logger.warning(
                                f"[风控] 账号 {account.userid} 获取订单第{attempt}次遇到风控，"
                                f"等待{WC_WAIT_SECONDS}秒后重试..."
                            )
                            await asyncio.sleep(WC_WAIT_SECONDS)
                            continue
                        else:
                            logger.warning(
                                f"[风控] 账号 {account.userid} 获取订单连续{WC_MAX_RETRIES}次遇到风控"
                            )
                            return [], True

                    # 其他错误
                    error_msg = str(result.get("message", ""))
                    if "418" in error_msg or "wind" in error_msg.lower():
                        if attempt < WC_MAX_RETRIES:
                            logger.warning(
                                f"[风控] 账号 {account.userid} 获取订单第{attempt}次遇到风控，"
                                f"等待{WC_WAIT_SECONDS}秒后重试..."
                            )
                            await asyncio.sleep(WC_WAIT_SECONDS)
                            continue
                        else:
                            logger.warning(
                                f"[风控] 账号 {account.userid} 获取订单连续{WC_MAX_RETRIES}次遇到风控"
                            )
                            return [], True

                    logger.error(f"Get orders for {account.userid} failed: {result.get('message')}")
                    return [], False

                orders = result.get("data", {}).get("data", {}).get("orders", [])
                return orders, False
            except Exception as e:
                logger.error(f"Get orders error for {account.userid}: {e}")
                return [], False

        return [], False

    def filter_new_orders(self, db: Session, account: MTAccount, orders: List[dict]) -> List[dict]:
        """
        筛选未落库的订单
        """
        if not orders:
            return []

        # 批量查询已存在的订单
        order_ids = [str(o.get("orderid", "") or o.get("stringOrderId", "")) for o in orders]
        existing = db.query(Order.order_id).filter(
            Order.account_id == account.id,
            Order.order_id.in_(order_ids)
        ).all()
        existing_ids = {e[0] for e in existing}

        # 筛选新订单
        new_orders = []
        for order in orders:
            order_id = str(order.get("orderid", "") or order.get("stringOrderId", ""))
            if order_id and order_id not in existing_ids:
                new_orders.append(order)

        return new_orders

    async def query_and_save_coupons(self, db: Session, account: MTAccount, order: dict) -> tuple:
        """
        查询订单券码并保存
        Returns:
            (status, detail) 元组
            status: 'success'=成功, 'failed'=失败, 'wind_control'=风控且重试耗尽
            detail: 成功时返回券码详情字典，失败时返回None
        """
        WC_MAX_RETRIES = 3
        WC_WAIT_SECONDS = 10

        order_view_id = str(order.get("stringOrderId", "") or order.get("orderid", ""))
        if not order_view_id:
            return "failed", None

        token = get_decrypted_token(account)

        for attempt in range(1, WC_MAX_RETRIES + 1):
            try:
                result = await self._call_meituan_api(token, order_view_id, account)

                # 遇到风控（418）
                if result.get("is_wind_control"):
                    if attempt < WC_MAX_RETRIES:
                        logger.warning(
                            f"[风控] 订单 {order_view_id} 第{attempt}次遇到风控，"
                            f"等待{WC_WAIT_SECONDS}秒后重试..."
                        )
                        await asyncio.sleep(WC_WAIT_SECONDS)
                        continue
                    else:
                        logger.warning(
                            f"[风控] 订单 {order_view_id} 连续{WC_MAX_RETRIES}次遇到风控，跳过该订单"
                        )
                        return "wind_control", None

                if not result.get("success"):
                    logger.warning(f"Query coupons failed for order {order_view_id}: {result.get('error')}")
                    return "failed", None

                coupons = result.get("coupons", [])
                if not coupons:
                    return "failed", None

                # 先保存订单
                order_record = Order(
                    account_id=account.id,
                    order_id=order_view_id,
                    order_view_id=order_view_id,
                    title=order.get("title", ""),
                    order_amount=order.get("orderAmount"),
                    order_status=order.get("tousestatus") or order.get("orderStatus"),
                    showstatus=order.get("showstatus", ""),
                    catename=order.get("catename", ""),
                    is_gift=order.get("catename") != "美食团购" and "礼物" in (order.get("showstatus") or ""),
                    order_pay_time=self._parse_order_time(order.get("ordertime")),
                    city_name=order.get("cityName", ""),
                    coupon_query_status=1  # 成功
                )
                db.add(order_record)
                db.flush()  # 获取order.id

                # 保存券码
                coupon_codes = []
                for coupon_info in coupons:
                    coupon_record = Coupon(
                        order_id=order_record.id,
                        account_id=account.id,
                        coupon_code=coupon_info.get("coupon", ""),
                        encode=coupon_info.get("encode", ""),
                        coupon_status=coupon_info.get("order_status", ""),
                        use_status=coupon_info.get("useStatus"),
                        raw_data={"data": coupons}
                    )
                    db.add(coupon_record)
                    coupon_codes.append(coupon_info.get("coupon", ""))

                db.commit()
                
                # 返回详情
                detail = {
                    "order_id": order_view_id,
                    "title": order.get("title", ""),
                    "account_userid": account.userid,
                    "coupons": coupon_codes
                }
                return "success", detail

            except Exception as e:
                logger.error(f"Query and save coupons error for order {order_view_id}: {e}")
                db.rollback()
                return "failed", None

        return "wind_control", None  # Should not reach here

    async def _call_meituan_api(self, token: str, order_id: str, account: MTAccount = None) -> dict:
        """调用Node.js脚本查询美团API"""
        import subprocess

        if not os.path.exists(self.script_path):
            return {"success": False, "error": "Script not found"}

        # 构建options，包含用户信息
        options = {}
        if account:
            options["userId"] = account.userid or ""
            options["openId"] = account.open_id or ""
            options["unionId"] = ""  # 如果有unionId字段可以添加
            options["uuid"] = account.csecuuid or "c34d9b03-7520-47e3-9d7c-17a3d930c48d"

        args = json.dumps({
            "token": token,
            "orderId": order_id,
            "options": options
        })

        try:
            def run_subprocess():
                result = subprocess.run(
                    ["node", self.script_path, "getCouponList", args],
                    capture_output=True,
                    timeout=30,
                    encoding='utf-8',
                    errors='replace'
                )
                if result.returncode != 0:
                    return {"success": False, "error": result.stderr}
                # 只取最后一行JSON
                lines = result.stdout.strip().split('\n')
                json_line = lines[-1] if lines else result.stdout
                return json.loads(json_line)

            result = await asyncio.to_thread(run_subprocess)
            # 检测风控（418）
            if not result.get("success"):
                error_msg = str(result.get("error", ""))
                if result.get("isWindControl") or "418" in error_msg:
                    result["is_wind_control"] = True
            return result
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _parse_order_time(self, timestamp: Optional[int]) -> Optional[datetime]:
        """解析订单时间"""
        if not timestamp:
            return None
        try:
            return datetime.fromtimestamp(timestamp)
        except:
            return None

    async def run_scan_for_account(self, db: Session, account: MTAccount, status_filter: int = 2) -> dict:
        """
        扫描单个账号的订单和券码
        Args:
            db: Database session
            account: Account to scan
            status_filter: 订单状态过滤 0=全部, 2=待使用, 3=已完成, 4=退款/售后
        Returns:
            扫描结果统计，包含 is_wind_control 字段表示是否遇到风控
        """
        # 创建任务日志
        task_log = ScheduledTaskLog(
            task_name="manual_scan",
            status="running",
            started_at=datetime.now()
        )
        db.add(task_log)
        db.commit()

        stats = {
            "accounts_scanned": 0,
            "orders_found": 0,
            "coupons_saved": 0,
            "is_wind_control": False  # 是否遇到风控
        }
        
        # 收集扫描详情
        scan_details = []

        # 追踪连续风控次数
        consecutive_wind_control = 0
        MAX_CONSECUTIVE_WIND_CONTROL = 3

        try:
            # 1. 检查账号有效性
            is_valid = await self.check_account_validity(account)
            if not is_valid:
                account.status = AccountStatus.INVALID
                account.last_check_time = datetime.now()
                db.commit()
                logger.warning(f"[扫描] 账号 {account.userid} Token已失效")

                # 发送微信通知 - 账号失效
                try:
                    await send_wechat_notification(
                        db,
                        "invalid",
                        remark=account.remark or "未设置",
                        userid=account.userid
                    )
                except Exception as notify_error:
                    logger.error(f"[扫描] 发送账号失效通知失败: {notify_error}")

                # 更新任务日志
                task_log.status = "success"
                task_log.accounts_scanned = 0
                task_log.orders_found = 0
                task_log.coupons_queried = 0
                task_log.finished_at = datetime.now()
                task_log.duration_seconds = int((task_log.finished_at - task_log.started_at).total_seconds())
                task_log.error_message = "账号Token已失效"
                db.commit()
                return stats

            stats["accounts_scanned"] = 1

            # 2. 获取订单
            orders, is_wind_control = await self.get_pending_orders(account, status_filter)
            if is_wind_control:
                stats["is_wind_control"] = True
                logger.warning(f"[扫描] 账号 {account.userid} 获取订单遇到风控，跳过该账号")

                # 发送微信通知 - 账号风控
                try:
                    await send_wechat_notification(
                        db,
                        "wind_control",
                        remark=account.remark or "未设置",
                        userid=account.userid
                    )
                except Exception as notify_error:
                    logger.error(f"[扫描] 发送账号风控通知失败: {notify_error}")
                # 更新任务日志
                task_log.status = "success"
                task_log.accounts_scanned = 1
                task_log.orders_found = 0
                task_log.coupons_queried = 0
                task_log.finished_at = datetime.now()
                task_log.duration_seconds = int((task_log.finished_at - task_log.started_at).total_seconds())
                task_log.error_message = "获取订单遇到风控"
                db.commit()
                return stats

            status_text = {0: "全部", 2: "待使用", 3: "已完成", 4: "退款/售后"}.get(status_filter, "待使用")
            logger.info(f"[扫描] 账号 {account.userid} 获取到 {len(orders)} 个{status_text}订单")

            # 3. 筛选未落库订单
            new_orders = self.filter_new_orders(db, account, orders)
            logger.info(f"[扫描] 账号 {account.userid} 有 {len(new_orders)} 个新订单")
            stats["orders_found"] = len(new_orders)

            # 4. 查询券码并保存
            for order in new_orders:
                result, detail = await self.query_and_save_coupons(db, account, order)
                if result == "success":
                    stats["coupons_saved"] += 1
                    consecutive_wind_control = 0  # 成功后重置计数
                    # 收集详情
                    if detail:
                        scan_details.append(detail)
                elif result == "wind_control":
                    consecutive_wind_control += 1
                    logger.warning(
                        f"[扫描] 账号 {account.userid} 连续{consecutive_wind_control}个订单遇到风控"
                    )
                    if consecutive_wind_control >= MAX_CONSECUTIVE_WIND_CONTROL:
                        stats["is_wind_control"] = True
                        logger.warning(
                            f"[扫描] 账号 {account.userid} 连续{MAX_CONSECUTIVE_WIND_CONTROL}个订单遇到风控，跳过该账号剩余订单"
                        )
                        break
                else:
                    consecutive_wind_control = 0  # 非风控失败也重置计数

                # 请求间隔
                await asyncio.sleep(self.request_interval)

            # 更新账号扫描时间
            account.last_scan_time = datetime.now()
            db.commit()

            # 更新任务日志
            task_log.status = "success"
            task_log.accounts_scanned = stats["accounts_scanned"]
            task_log.orders_found = stats["orders_found"]
            task_log.coupons_queried = stats["coupons_saved"]
            task_log.finished_at = datetime.now()
            task_log.duration_seconds = int((task_log.finished_at - task_log.started_at).total_seconds())
            if stats["is_wind_control"]:
                task_log.error_message = "部分订单因风控跳过"
            # 保存扫描详情
            if scan_details:
                task_log.scan_details = json.dumps(scan_details, ensure_ascii=False)
            db.commit()

            logger.info(f"[扫描] 账号 {account.userid} 扫描完成: {stats}")

        except Exception as e:
            logger.error(f"[扫描] 账号 {account.userid} 扫描失败: {e}")
            # 更新任务日志为失败
            task_log.status = "failed"
            task_log.finished_at = datetime.now()
            task_log.duration_seconds = int((task_log.finished_at - task_log.started_at).total_seconds())
            task_log.error_message = str(e)
            db.commit()

        return stats

    async def run_scan_task(self, db: Session) -> dict:
        """
        执行扫描任务
        Returns:
            任务结果统计
        """
        task_log = ScheduledTaskLog(
            task_name="scan_coupons",
            status="running",
            started_at=datetime.now()
        )
        db.add(task_log)
        db.commit()

        stats = {
            "accounts_scanned": 0,
            "accounts_invalid": 0,
            "orders_found": 0,
            "coupons_saved": 0,
            "errors": [],
            "stopped_by_wind_control": False  # 是否因连续风控停止
        }
        
        # 收集扫描详情
        scan_details = []

        # 追踪连续风控账号数
        consecutive_wind_control_accounts = 0
        MAX_CONSECUTIVE_WIND_CONTROL_ACCOUNTS = 3

        try:
            # 1. 获取所有有效且未被禁用的账号
            accounts = db.query(MTAccount).filter(
                MTAccount.status == AccountStatus.NORMAL,
                MTAccount.disabled == 0  # 只扫描未被禁用的账号
            ).all()

            logger.info(f"[定时任务] 开始扫描 {len(accounts)} 个账号")

            for account in accounts:
                # 检查是否需要停止
                if consecutive_wind_control_accounts >= MAX_CONSECUTIVE_WIND_CONTROL_ACCOUNTS:
                    logger.warning(
                        f"[定时任务] 连续{MAX_CONSECUTIVE_WIND_CONTROL_ACCOUNTS}个账号遇到风控，停止扫描任务"
                    )
                    stats["stopped_by_wind_control"] = True

                    # 发送微信通知 - 批量风控停止
                    try:
                        await send_wechat_notification(
                            db,
                            "batch_wind_control",
                            count=MAX_CONSECUTIVE_WIND_CONTROL_ACCOUNTS
                        )
                    except Exception as notify_error:
                        logger.error(f"[定时任务] 发送批量风控通知失败: {notify_error}")

                    break

                try:
                    # 2. 检查账号有效性
                    is_valid = await self.check_account_validity(account)
                    if not is_valid:
                        logger.warning(f"[定时任务] 账号 {account.userid} Token已失效")
                        account.status = AccountStatus.INVALID
                        account.last_check_time = datetime.now()
                        db.commit()
                        stats["accounts_invalid"] += 1
                        consecutive_wind_control_accounts = 0  # 非风控失败重置计数

                        # 发送微信通知 - 账号失效
                        try:
                            await send_wechat_notification(
                                db,
                                "invalid",
                                remark=account.remark or "未设置",
                                userid=account.userid
                            )
                        except Exception as notify_error:
                            logger.error(f"[定时任务] 发送账号失效通知失败: {notify_error}")

                        continue

                    stats["accounts_scanned"] += 1

                    # 3. 获取待使用订单
                    orders, is_wind_control = await self.get_pending_orders(account)
                    if is_wind_control:
                        consecutive_wind_control_accounts += 1
                        logger.warning(
                            f"[定时任务] 账号 {account.userid} 获取订单遇到风控 "
                            f"(连续{consecutive_wind_control_accounts}个账号风控)"
                        )

                        # 发送微信通知 - 账号风控
                        try:
                            await send_wechat_notification(
                                db,
                                "wind_control",
                                remark=account.remark or "未设置",
                                userid=account.userid
                            )
                        except Exception as notify_error:
                            logger.error(f"[定时任务] 发送账号风控通知失败: {notify_error}")

                        continue

                    # 获取订单成功，重置风控计数
                    consecutive_wind_control_accounts = 0
                    logger.info(f"[定时任务] 账号 {account.userid} 获取到 {len(orders)} 个待使用订单")

                    # 4. 筛选未落库订单
                    new_orders = self.filter_new_orders(db, account, orders)
                    logger.info(f"[定时任务] 账号 {account.userid} 有 {len(new_orders)} 个新订单")
                    stats["orders_found"] += len(new_orders)

                    # 追踪账号内连续风控订单
                    consecutive_wind_control_orders = 0
                    MAX_CONSECUTIVE_WIND_CONTROL_ORDERS = 3

                    # 5. 查询券码并保存
                    for order in new_orders:
                        result, detail = await self.query_and_save_coupons(db, account, order)
                        if result == "success":
                            stats["coupons_saved"] += 1
                            consecutive_wind_control_orders = 0  # 成功后重置
                            # 收集详情
                            if detail:
                                scan_details.append(detail)
                        elif result == "wind_control":
                            consecutive_wind_control_orders += 1
                            logger.warning(
                                f"[定时任务] 账号 {account.userid} 连续{consecutive_wind_control_orders}个订单遇到风控"
                            )
                            if consecutive_wind_control_orders >= MAX_CONSECUTIVE_WIND_CONTROL_ORDERS:
                                logger.warning(
                                    f"[定时任务] 账号 {account.userid} 连续{MAX_CONSECUTIVE_WIND_CONTROL_ORDERS}个订单遇到风控，跳过剩余订单"
                                )
                                # 将此账号标记为风控账号
                                consecutive_wind_control_accounts += 1
                                break
                        else:
                            consecutive_wind_control_orders = 0  # 非风控失败也重置

                        # 请求间隔
                        await asyncio.sleep(self.request_interval)

                    # 更新账号检查时间
                    account.last_check_time = datetime.now()
                    db.commit()

                except Exception as e:
                    logger.error(f"[定时任务] 处理账号 {account.userid} 出错: {e}")
                    stats["errors"].append({"account": account.userid, "error": str(e)})
                    consecutive_wind_control_accounts = 0  # 异常情况重置风控计数

                # 账号间间隔
                await asyncio.sleep(self.request_interval)

            # 更新任务日志
            task_log.status = "success"
            task_log.accounts_scanned = stats["accounts_scanned"]
            task_log.orders_found = stats["orders_found"]
            task_log.coupons_queried = stats["coupons_saved"]
            task_log.finished_at = datetime.now()
            task_log.duration_seconds = int((task_log.finished_at - task_log.started_at).total_seconds())
            if stats["stopped_by_wind_control"]:
                task_log.error_message = f"因连续{MAX_CONSECUTIVE_WIND_CONTROL_ACCOUNTS}个账号遇到风控而停止"
            # 保存扫描详情
            if scan_details:
                task_log.scan_details = json.dumps(scan_details, ensure_ascii=False)
            db.commit()

            logger.info(f"[定时任务] 扫描完成: {stats}")

        except Exception as e:
            logger.error(f"[定时任务] 任务执行失败: {e}")
            task_log.status = "failed"
            task_log.error_message = str(e)
            task_log.finished_at = datetime.now()
            task_log.duration_seconds = int((task_log.finished_at - task_log.started_at).total_seconds())
            db.commit()
            stats["errors"].append({"error": str(e)})

        return stats


# 全局服务实例
task_service = ScheduledTaskService()


async def run_scheduled_scan():
    """定时扫描任务入口"""
    db = SessionLocal()
    try:
        return await task_service.run_scan_task(db)
    finally:
        db.close()


def get_scan_interval_minutes(db: Session) -> int:
    """从系统配置获取扫描间隔"""
    config = db.query(SystemConfig).filter(SystemConfig.config_key == "scan_interval").first()
    if config and config.config_value:
        try:
            return int(config.config_value)
        except:
            pass
    return settings.SCAN_INTERVAL_MINUTES
