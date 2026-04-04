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
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models.account import MTAccount, AccountStatus
from app.models.order import Order
from app.models.coupon import Coupon
from app.models.log import ScheduledTaskLog
from app.models.config import SystemConfig
from app.config import settings
from app.utils.encryption import decrypt_token
from app.utils.order_status import normalize_order_status_bucket
from app.services.notification import send_wechat_notification

logger = logging.getLogger(__name__)


def get_decrypted_token(account: MTAccount) -> str:
    """获取账号的解密Token"""
    return decrypt_token(account.token)


class ScheduledTaskService:
    """定时任务服务"""

    def __init__(self):
        self.request_interval = settings.SCAN_REQUEST_INTERVAL
        self.coupon_query_interval = settings.SCAN_COUPON_QUERY_INTERVAL
        self.node_path = settings.NODE_PATH or os.getenv("NODE_PATH", "node")
        base_dir = os.path.dirname(os.path.abspath(__file__))
        self.script_path = os.path.join(base_dir, "meituanBackendApi.cjs")
        # 单 Node.js worker（单线程模式）
        self._node_workers = [
            {"process": None, "lock": asyncio.Lock(), "stderr_task": None}
        ]
        self._node_worker_pool_lock = asyncio.Lock()
        self._node_request_id = 0

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

    def _extract_order_identity(self, order: dict) -> tuple[str, str]:
        order_id = str(order.get("orderid", "") or order.get("stringOrderId", "") or "").strip()
        order_view_id = str(order.get("stringOrderId", "") or order.get("orderid", "") or "").strip()
        return order_id, (order_view_id or order_id)

    def _apply_order_snapshot(
        self,
        order_record: Order,
        account: MTAccount,
        order: dict,
        order_id: str,
        order_view_id: str,
        coupon_query_status: int,
    ) -> None:
        order_record.account_id = account.id
        order_record.order_id = order_id
        order_record.order_view_id = order_view_id
        order_record.title = order.get("title", "")
        order_record.order_amount = order.get("orderAmount")
        order_record.order_status = order.get("tousestatus") or order.get("orderStatus")
        order_record.order_status_bucket = normalize_order_status_bucket(
            order_record.order_status,
            order.get("showstatus", ""),
        )
        order_record.showstatus = order.get("showstatus", "")
        order_record.catename = order.get("catename", "")
        order_record.is_gift = order.get("catename") != "缇庨鍥㈣喘" and "绀肩墿" in (order.get("showstatus") or "")
        order_record.order_pay_time = self._parse_order_time(order.get("ordertime"))
        order_record.city_name = order.get("cityName", "")
        order_record.coupon_query_status = coupon_query_status

    def filter_new_orders(self, db: Session, account: MTAccount, orders: List[dict]) -> List[dict]:
        """
        筛选未落库的订单
        """
        if not orders:
            return []

        normalized_orders = []
        seen_order_ids = set()
        for order in orders:
            order_id, _ = self._extract_order_identity(order)
            if not order_id or order_id in seen_order_ids:
                continue
            seen_order_ids.add(order_id)
            normalized_orders.append(order)

        if not normalized_orders:
            return []

        existing = db.query(Order.order_id).filter(
            Order.account_id == account.id,
            Order.order_id.in_(list(seen_order_ids))
        ).all()
        existing_ids = {row[0] for row in existing}

        return [
            order for order in normalized_orders
            if self._extract_order_identity(order)[0] not in existing_ids
        ]

    def _normalize_coupon_result(self, raw_coupons: list) -> tuple[list, list]:
        normalized_coupons = []
        coupon_codes = []
        seen_coupon_codes = set()

        for coupon_info in raw_coupons or []:
            coupon_code = str(coupon_info.get("coupon", "") or "").strip()
            if not coupon_code or coupon_code in seen_coupon_codes:
                continue
            seen_coupon_codes.add(coupon_code)
            normalized_coupons.append(coupon_info)
            coupon_codes.append(coupon_code)

        return normalized_coupons, coupon_codes

    async def query_coupon_data(self, account: MTAccount, order: dict) -> tuple:
        WC_MAX_RETRIES = 3
        WC_WAIT_SECONDS = 10

        order_id, order_view_id = self._extract_order_identity(order)
        if not order_id or not order_view_id:
            return "failed", None

        token = get_decrypted_token(account)

        for attempt in range(1, WC_MAX_RETRIES + 1):
            try:
                result = await self._call_meituan_api(token, order_view_id, account)

                if result.get("is_wind_control"):
                    if attempt < WC_MAX_RETRIES:
                        logger.warning(
                            f"[风控] 订单 {order_view_id} 第{attempt}次遇到风控，"
                            f"等待{WC_WAIT_SECONDS}秒后重试..."
                        )
                        await asyncio.sleep(WC_WAIT_SECONDS)
                        continue

                    logger.warning(
                        f"[风控] 订单 {order_view_id} 连续{WC_MAX_RETRIES}次遇到风控，跳过该订单"
                    )
                    return "wind_control", None

                raw_coupons = result.get("coupons", []) or []
                normalized_coupons, coupon_codes = self._normalize_coupon_result(raw_coupons)

                return "success" if result.get("success") else "failed", {
                    "order_id": order_id,
                    "order_view_id": order_view_id,
                    "order": order,
                    "result": result,
                    "raw_coupons": raw_coupons,
                    "normalized_coupons": normalized_coupons,
                    "coupon_codes": coupon_codes,
                }
            except Exception as exc:
                logger.error("Query coupons error for order %s: %s", order_view_id, exc)
                return "failed", {
                    "order_id": order_id,
                    "order_view_id": order_view_id,
                    "order": order,
                    "result": {"success": False, "error": str(exc)},
                    "raw_coupons": [],
                    "normalized_coupons": [],
                    "coupon_codes": [],
                }

        return "wind_control", None

    def save_coupon_query_result(
        self,
        db: Session,
        account: MTAccount,
        query_status: str,
        query_payload: dict | None,
    ) -> tuple:
        if query_status == "wind_control" or not query_payload:
            return query_status, None

        order = query_payload["order"]
        order_id = query_payload["order_id"]
        order_view_id = query_payload["order_view_id"]
        result = query_payload["result"]
        raw_coupons = query_payload["raw_coupons"]
        normalized_coupons = query_payload["normalized_coupons"]
        coupon_codes = query_payload["coupon_codes"]

        try:
            order_record = db.query(Order).filter(
                and_(
                    Order.account_id == account.id,
                    Order.order_id == order_id,
                )
            ).first()
            if order_record is None:
                order_record = Order()
                db.add(order_record)

            self._apply_order_snapshot(
                order_record=order_record,
                account=account,
                order=order,
                order_id=order_id,
                order_view_id=order_view_id,
                coupon_query_status=1 if query_status == "success" and coupon_codes else 2,
            )
            db.flush()

            if query_status != "success":
                db.commit()
                logger.warning(f"Query coupons failed for order {order_view_id}: {result.get('error')}")
                return "failed", None

            existing_coupons = {}
            if coupon_codes:
                existing_coupon_rows = db.query(Coupon).filter(
                    Coupon.order_id == order_record.id,
                    Coupon.coupon_code.in_(coupon_codes),
                ).all()
                existing_coupons = {
                    str(coupon.coupon_code or "").strip(): coupon
                    for coupon in existing_coupon_rows
                    if coupon.coupon_code
                }

            for coupon_info in normalized_coupons:
                coupon_code = str(coupon_info.get("coupon", "") or "").strip()
                coupon_record = existing_coupons.get(coupon_code)
                if coupon_record is None:
                    coupon_record = Coupon(
                        order_id=order_record.id,
                        account_id=account.id,
                        coupon_code=coupon_code,
                    )
                    db.add(coupon_record)

                coupon_record.order_id = order_record.id
                coupon_record.account_id = account.id
                coupon_record.coupon_code = coupon_code
                coupon_record.encode = coupon_info.get("encode", "")
                coupon_record.coupon_status = coupon_info.get("order_status", "")
                coupon_record.use_status = coupon_info.get("useStatus")
                coupon_record.raw_data = {"data": raw_coupons}

            db.commit()

            if not coupon_codes:
                return "failed", None

            detail = {
                "order_id": order_id,
                "order_view_id": order_view_id,
                "title": order.get("title", ""),
                "account_userid": account.userid,
                "coupons": coupon_codes,
            }
            return "success", detail
        except IntegrityError as exc:
            logger.warning(
                "Integrity conflict while saving coupons for account_id=%s order_id=%s: %s",
                account.id,
                order_id,
                exc,
            )
            db.rollback()
            return "failed", None
        except Exception as exc:
            logger.error("Save coupon query result error for order %s: %s", order_view_id, exc)
            db.rollback()
            return "failed", None

    async def query_and_save_coupons(self, db: Session, account: MTAccount, order: dict) -> tuple:
        query_status, query_payload = await self.query_coupon_data(account, order)
        return self.save_coupon_query_result(db, account, query_status, query_payload)

    @staticmethod
    def _interleave(account_orders_map: dict) -> list:
        """
        将多账号订单列表交替合并。
        {A: [a1, a2], B: [b1, b2, b3]} ->
        [(A, a1), (B, b1), (A, a2), (B, b2), (B, b3)]
        """
        accounts = list(account_orders_map.keys())
        lists = [account_orders_map[a] for a in accounts]
        result = []
        max_len = max((len(lst) for lst in lists), default=0)
        for i in range(max_len):
            for acc, lst in zip(accounts, lists):
                if i < len(lst):
                    result.append((acc, lst[i]))
        return result

    async def process_orders_single_thread(
        self, db: Session, account: MTAccount, orders: List[dict]
    ) -> dict:
        """单线程顺序查询并保存一组订单的券码（供手动扫描单账号使用）"""
        consecutive_wind_control = 0
        max_consecutive_wind_control = 3
        saved_count = 0
        scan_details = []
        is_wind_control = False

        for order in orders:
            query_status, query_payload = await self.query_coupon_data(account, order)
            result, detail = self.save_coupon_query_result(db, account, query_status, query_payload)

            if result == "success":
                saved_count += 1
                consecutive_wind_control = 0
                if detail:
                    scan_details.append(detail)
            elif result == "wind_control":
                consecutive_wind_control += 1
                logger.warning(
                    "[scan_single] account=%s consecutive_wind_control=%s order_id=%s",
                    account.userid,
                    consecutive_wind_control,
                    self._extract_order_identity(order)[1],
                )
                if consecutive_wind_control >= max_consecutive_wind_control:
                    is_wind_control = True
                    break
            else:
                consecutive_wind_control = 0

            if not is_wind_control:
                await asyncio.sleep(self.coupon_query_interval)

        return {
            "coupons_saved": saved_count,
            "scan_details": scan_details,
            "is_wind_control": is_wind_control,
        }

    async def _drain_node_worker_stderr(self, process, worker_index: int) -> None:
        if process is None or process.stderr is None:
            return

        try:
            while True:
                line = await process.stderr.readline()
                if not line:
                    break
                message = line.decode("utf-8", errors="replace").rstrip()
                if message:
                    logger.debug("[meituan_node_worker:%s] %s", worker_index, message)
        except Exception as exc:
            logger.debug("Node worker stderr reader stopped for worker %s: %s", worker_index, exc)

    async def _stop_node_worker(self, worker_index: int) -> None:
        worker = self._node_workers[worker_index]
        process = worker["process"]
        worker["process"] = None

        if process is None:
            return

        try:
            if process.stdin is not None and not process.stdin.is_closing():
                process.stdin.close()
        except Exception:
            pass

        try:
            if process.returncode is None:
                process.terminate()
                await asyncio.wait_for(process.wait(), timeout=5)
        except Exception:
            try:
                process.kill()
                await process.wait()
            except Exception:
                pass

        stderr_task = worker["stderr_task"]
        worker["stderr_task"] = None
        if stderr_task is not None:
            stderr_task.cancel()

    async def _pick_node_worker_index(self) -> int:
        """始终返回唯一的 worker 0（单线程模式）"""
        return 0

    async def _ensure_node_worker(self, worker_index: int):
        worker = self._node_workers[worker_index]
        process = worker["process"]
        if process is not None and process.returncode is None:
            return process

        if not os.path.exists(self.script_path):
            raise FileNotFoundError("Script not found")

        async with self._node_worker_pool_lock:
            process = worker["process"]
            if process is not None and process.returncode is None:
                return process

            await self._stop_node_worker(worker_index)

            process = await asyncio.create_subprocess_exec(
                self.node_path,
                self.script_path,
                "serve",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            worker["process"] = process
            worker["stderr_task"] = asyncio.create_task(self._drain_node_worker_stderr(process, worker_index))
            logger.info("Started Meituan node worker worker_index=%s pid=%s", worker_index, process.pid)
            return process

    async def _call_node_worker(self, action: str, params: dict, timeout_seconds: float = 35.0) -> dict:
        worker_index = await self._pick_node_worker_index()
        worker = self._node_workers[worker_index]
        async with worker["lock"]:
            process = await self._ensure_node_worker(worker_index)
            self._node_request_id += 1
            request_id = self._node_request_id

            payload = json.dumps(
                {
                    "request_id": request_id,
                    "action": action,
                    "params": params,
                },
                ensure_ascii=False,
            ) + "\n"

            try:
                process.stdin.write(payload.encode("utf-8"))
                await process.stdin.drain()
                raw_line = await asyncio.wait_for(process.stdout.readline(), timeout=timeout_seconds)
                if not raw_line:
                    raise RuntimeError("Node worker exited before returning a result")

                response = json.loads(raw_line.decode("utf-8").strip())
                if response.get("request_id") != request_id:
                    raise RuntimeError("Node worker response id mismatch")
                return response.get("result", {})
            except Exception:
                await self._stop_node_worker(worker_index)
                raise

    async def _call_meituan_api(self, token: str, order_id: str, account: MTAccount = None) -> dict:
        """调用Node.js脚本查询美团API"""
        options = {}
        if account:
            options["userId"] = account.userid or ""
            options["openId"] = account.open_id or ""
            options["unionId"] = ""
            options["uuid"] = account.csecuuid or "c34d9b03-7520-47e3-9d7c-17a3d930c48d"

        try:
            result = await self._call_node_worker(
                "getCouponList",
                {
                    "token": token,
                    "orderId": order_id,
                    "options": options,
                },
            )
            if not result.get("success"):
                error_msg = str(result.get("error", ""))
                if result.get("isWindControl") or "418" in error_msg:
                    result["is_wind_control"] = True
            return result
        except Exception as e:
            logger.error("Node worker call failed for order %s: %s", order_id, e)
            return {"success": False, "error": str(e)}

    async def close(self) -> None:
        from app.services.meituan.api import MeituanAPI

        for worker_index in range(len(self._node_workers)):
            worker = self._node_workers[worker_index]
            async with worker["lock"]:
                await self._stop_node_worker(worker_index)

        await MeituanAPI.close()

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

            pipeline_result = await self.process_orders_single_thread(db, account, new_orders)
            stats["coupons_saved"] += pipeline_result["coupons_saved"]
            scan_details.extend(pipeline_result["scan_details"])
            if pipeline_result["is_wind_control"]:
                consecutive_wind_control = MAX_CONSECUTIVE_WIND_CONTROL
                stats["is_wind_control"] = True
                logger.warning(
                    f"[扫描] 账号 {account.userid} 连续{MAX_CONSECUTIVE_WIND_CONTROL}个订单遇到风控，跳过该账号剩余订单"
                )

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
            from app.routers.orders import invalidate_order_list_count_cache
            from app.routers.stats import invalidate_dashboard_stats_cache
            invalidate_order_list_count_cache()
            invalidate_dashboard_stats_cache()

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
        执行定时扫描任务（两阶段）：
          Phase 1: 逐账号收集新订单（请求间隔 request_interval）
          Phase 2: 交替轮询各账号券码（请求间隔 coupon_query_interval）
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
            "stopped_by_wind_control": False
        }
        scan_details = []

        # ------------------------------------------------------------------ #
        # Phase 1: 收集所有账号的新订单（单线程，request_interval 间隔）       #
        # ------------------------------------------------------------------ #
        try:
            accounts = db.query(MTAccount).filter(
                MTAccount.status == AccountStatus.NORMAL,
                MTAccount.disabled == 0
            ).all()

            logger.info(f"[定时任务] Phase 1: 开始收集 {len(accounts)} 个账号的新订单")

            account_orders_map: dict[MTAccount, list] = {}  # account -> [new_orders]
            consecutive_wind_control_accounts = 0
            MAX_CONSECUTIVE_WIND_CONTROL_ACCOUNTS = 3

            for idx, account in enumerate(accounts):
                # 连续风控检查
                if consecutive_wind_control_accounts >= MAX_CONSECUTIVE_WIND_CONTROL_ACCOUNTS:
                    logger.warning(
                        f"[定时任务] Phase 1: 连续{MAX_CONSECUTIVE_WIND_CONTROL_ACCOUNTS}个账号遇到风控，停止收集"
                    )
                    stats["stopped_by_wind_control"] = True
                    try:
                        await send_wechat_notification(
                            db, "batch_wind_control",
                            count=MAX_CONSECUTIVE_WIND_CONTROL_ACCOUNTS
                        )
                    except Exception as notify_error:
                        logger.error(f"[定时任务] 发送批量风控通知失败: {notify_error}")
                    break

                try:
                    # 检查账号有效性
                    is_valid = await self.check_account_validity(account)
                    if not is_valid:
                        logger.warning(f"[定时任务] 账号 {account.userid} Token已失效")
                        account.status = AccountStatus.INVALID
                        account.last_check_time = datetime.now()
                        db.commit()
                        stats["accounts_invalid"] += 1
                        consecutive_wind_control_accounts = 0
                        try:
                            await send_wechat_notification(
                                db, "invalid",
                                remark=account.remark or "未设置",
                                userid=account.userid
                            )
                        except Exception as notify_error:
                            logger.error(f"[定时任务] 发送账号失效通知失败: {notify_error}")
                        continue

                    stats["accounts_scanned"] += 1

                    # 获取待使用订单
                    orders, is_wind_control = await self.get_pending_orders(account)
                    if is_wind_control:
                        consecutive_wind_control_accounts += 1
                        logger.warning(
                            f"[定时任务] Phase 1: 账号 {account.userid} 获取订单遇到风控 "
                            f"(连续{consecutive_wind_control_accounts}个账号风控)"
                        )
                        try:
                            await send_wechat_notification(
                                db, "wind_control",
                                remark=account.remark or "未设置",
                                userid=account.userid
                            )
                        except Exception as notify_error:
                            logger.error(f"[定时任务] 发送账号风控通知失败: {notify_error}")
                        account_orders_map[account] = []
                    else:
                        consecutive_wind_control_accounts = 0
                        new_orders = self.filter_new_orders(db, account, orders)
                        logger.info(
                            f"[定时任务] Phase 1: 账号 {account.userid} "
                            f"获取到 {len(orders)} 个待使用订单，其中 {len(new_orders)} 个新订单"
                        )
                        stats["orders_found"] += len(new_orders)
                        account_orders_map[account] = new_orders

                except Exception as e:
                    logger.error(f"[定时任务] Phase 1: 处理账号 {account.userid} 出错: {e}")
                    stats["errors"].append({"account": account.userid, "error": str(e)})
                    consecutive_wind_control_accounts = 0
                    account_orders_map[account] = []

                # 账号间间隔（仅非最后一个账号）
                if idx < len(accounts) - 1:
                    await asyncio.sleep(self.request_interval)

            # ------------------------------------------------------------------ #
            # Phase 2: 交替轮询券码（单线程，coupon_query_interval 间隔）          #
            # ------------------------------------------------------------------ #
            interleaved = self._interleave(account_orders_map)
            total_orders = len(interleaved)
            logger.info(f"[定时任务] Phase 2: 开始交替查询券码，共 {total_orders} 个订单")

            consecutive_wc = 0
            MAX_CONSECUTIVE_WC = 3

            for q_idx, (account, order) in enumerate(interleaved):
                if consecutive_wc >= MAX_CONSECUTIVE_WC:
                    logger.warning(
                        f"[定时任务] Phase 2: 连续{MAX_CONSECUTIVE_WC}次风控，停止查询"
                    )
                    stats["stopped_by_wind_control"] = True
                    break

                try:
                    order_view_id = self._extract_order_identity(order)[1]
                    logger.info(
                        f"[定时任务] Phase 2: [{q_idx + 1}/{total_orders}] "
                        f"账号 {account.userid} 查询订单 {order_view_id}"
                    )
                    query_status, query_payload = await self.query_coupon_data(account, order)
                    result, detail = self.save_coupon_query_result(db, account, query_status, query_payload)

                    if result == "success":
                        stats["coupons_saved"] += 1
                        consecutive_wc = 0
                        if detail:
                            scan_details.append(detail)
                    elif result == "wind_control":
                        consecutive_wc += 1
                        logger.warning(
                            f"[定时任务] Phase 2: 账号 {account.userid} 订单 {order_view_id} 风控 "
                            f"(连续{consecutive_wc}次)"
                        )
                    else:
                        consecutive_wc = 0

                    # 更新账号最后扫描时间
                    account.last_check_time = datetime.now()
                    db.commit()

                except Exception as e:
                    logger.error(
                        f"[定时任务] Phase 2: 账号 {account.userid} 查询订单出错: {e}"
                    )
                    stats["errors"].append({"account": account.userid, "error": str(e)})
                    consecutive_wc = 0

                # 券码间间隔（仅非最后一个）
                if q_idx < total_orders - 1:
                    await asyncio.sleep(self.coupon_query_interval)

            # 更新任务日志
            task_log.status = "success"
            task_log.accounts_scanned = stats["accounts_scanned"]
            task_log.orders_found = stats["orders_found"]
            task_log.coupons_queried = stats["coupons_saved"]
            task_log.finished_at = datetime.now()
            task_log.duration_seconds = int((task_log.finished_at - task_log.started_at).total_seconds())
            if stats["stopped_by_wind_control"]:
                task_log.error_message = f"因连续风控停止"
            if scan_details:
                task_log.scan_details = json.dumps(scan_details, ensure_ascii=False)
            db.commit()

            from app.routers.orders import invalidate_order_list_count_cache
            from app.routers.stats import invalidate_dashboard_stats_cache
            invalidate_order_list_count_cache()
            invalidate_dashboard_stats_cache()

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
