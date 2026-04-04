import logging
import time
from typing import List
from collections import defaultdict
import subprocess
import json
import os
import asyncio
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.coupon import Coupon
from app.models.coupon_history import CouponHistory
from app.models.order import Order
from app.models.account import MTAccount
from app.schemas.coupon import (
    CouponResponse, CouponQueryRequest, CouponQueryResponse,
    CouponBackendQueryResponse, CouponBatchUpdateRequest, CouponChangeInfo
)
from app.deps import get_current_user
from app.utils.encryption import decrypt_token
from app.services.coupon_change_service import (
    find_coupon_by_code,
    batch_find_coupons_by_codes,
    CouponChangeDetector,
    apply_coupon_changes,
    get_coupon_change_info
)

router = APIRouter(prefix="/api/coupons", tags=["coupons"])
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


async def call_meituan_api(token: str, order_id: str, options: dict = None) -> dict:
    """调用 Node.js 脚本查询美团API"""
    if options is None:
        options = {}

    # 获取脚本路径
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    script_path = os.path.join(base_dir, "services", "meituan", "meituanBackendApi.cjs")

    logger.debug("[coupon_backend] script_path=%s exists=%s", script_path, os.path.exists(script_path))

    if not os.path.exists(script_path):
        raise Exception(f"Script not found: {script_path}")

    args = json.dumps({
        "token": token,
        "orderId": order_id,
        "options": options
    })

    logger.debug("[coupon_backend] calling_node order_id=%s", order_id)

    try:
        # 在线程池中运行同步的subprocess
        def run_subprocess():
            result = subprocess.run(
                ["node", script_path, "getCouponList", args],
                capture_output=True,
                timeout=30,
                encoding='utf-8',
                errors='replace'
            )
            logger.debug("[coupon_backend] node_returncode=%s", result.returncode)
            logger.debug("[coupon_backend] node_stdout=%s", result.stdout[:500] if result.stdout else 'empty')
            logger.debug("[coupon_backend] node_stderr=%s", result.stderr[:500] if result.stderr else 'empty')
            if result.returncode != 0:
                raise Exception(f"Node.js error: {result.stderr}")

            # 只取最后一行JSON（过滤掉其他日志输出）
            stdout = result.stdout.strip()
            lines = stdout.split('\n')
            json_line = lines[-1] if lines else stdout

            return json.loads(json_line)

        return await asyncio.to_thread(run_subprocess)
    except subprocess.TimeoutExpired:
        raise Exception("API timeout")
    except json.JSONDecodeError as e:
        raise Exception(f"Parse error: {e}")


async def _query_coupons_backend_grouped(
    request: CouponQueryRequest,
    db: Session,
) -> List[CouponBackendQueryResponse]:
    started_at = time.perf_counter()
    coupon_results = batch_find_coupons_by_codes(db, request.coupon_codes)
    unique_input_codes = len(dict.fromkeys(code for code in request.coupon_codes if code))

    order_ids = {
        result["coupon"].order_id
        for result in coupon_results.values()
        if result.get("coupon")
    }
    coupon_ids = {
        result["coupon"].id
        for result in coupon_results.values()
        if result.get("coupon")
    }

    orders = db.query(Order).filter(Order.id.in_(order_ids)).all() if order_ids else []
    order_map = {order.id: order for order in orders}

    account_ids = {order.account_id for order in orders if order.account_id}
    accounts = db.query(MTAccount).filter(MTAccount.id.in_(account_ids)).all() if account_ids else []
    account_map = {account.id: account for account in accounts}

    coupons_by_order = defaultdict(list)
    if order_ids:
        for db_coupon in db.query(Coupon).filter(Coupon.order_id.in_(order_ids)).all():
            coupons_by_order[db_coupon.order_id].append(db_coupon)

    history_counts = {}
    if coupon_ids:
        history_counts = {
            coupon_id: count
            for coupon_id, count in db.query(
                CouponHistory.coupon_id,
                func.count(CouponHistory.id),
            ).filter(
                CouponHistory.coupon_id.in_(coupon_ids)
            ).group_by(
                CouponHistory.coupon_id
            ).all()
        }

    order_coupons = defaultdict(list)
    for code in request.coupon_codes:
        result = coupon_results.get(code) or {}
        coupon = result.get("coupon")
        if coupon:
            order_coupons[coupon.order_id].append(code)

    order_api_context = {}
    api_call_attempts = 0
    api_call_successes = 0
    skipped_order_groups = 0
    applied_change_count = 0
    for order_id in order_coupons:
        order = order_map.get(order_id)
        if not order:
            skipped_order_groups += 1
            continue

        account = account_map.get(order.account_id)
        if not account or not account.token:
            skipped_order_groups += 1
            continue

        id_str = str(order.order_view_id or "")
        is_gift_id = len(id_str) > 20 or id_str.startswith(("G", "g"))
        display_order_id = "-" if is_gift_id else (order.order_view_id or "-")
        default_gift_id = id_str if is_gift_id else "-"
        query_order_id = id_str if is_gift_id else order.order_view_id

        try:
            api_call_attempts += 1
            decrypted_token = decrypt_token(account.token)
            options = {
                "userId": account.userid or "",
                "openId": account.open_id or "",
                "uuid": account.csecuuid or "c34d9b03-7520-47e3-9d7c-17a3d930c48d",
            }
            api_result = await call_meituan_api(decrypted_token, query_order_id, options)
        except Exception as exc:
            order_api_context[order_id] = {
                "status": "error",
                "message": f"Backend query failed: {exc}",
                "display_order_id": display_order_id,
                "default_gift_id": default_gift_id,
                "userid": account.userid,
            }
            continue

        if not api_result.get("success") or not api_result.get("coupons"):
            error_msg = api_result.get("error", "Unknown API error")
            order_api_context[order_id] = {
                "status": "api_error",
                "message": f"Meituan API failed: {error_msg}",
                "display_order_id": display_order_id,
                "default_gift_id": default_gift_id,
                "userid": account.userid,
            }
            continue

        api_call_successes += 1
        coupons_list = api_result["coupons"]
        db_coupons = coupons_by_order.get(order_id, [])
        detector = CouponChangeDetector(db_coupons, coupons_list)
        detection_result = detector.detect_changes()
        applied_change_count += len(detection_result["changes"])

        if detection_result["changes"]:
            apply_coupon_changes(
                db,
                order.id,
                order.account_id,
                detection_result["changes"]
            )
            db_coupons = db.query(Coupon).filter(Coupon.order_id == order_id).all()
            coupons_by_order[order_id] = db_coupons

        change_map = {
            change["db_coupon"].id: change
            for change in detection_result["changes"]
        }
        change_type = "none"
        if detection_result["is_full_change"]:
            change_type = "full"
        elif detection_result["is_partial_change"]:
            change_type = "partial"

        order_api_context[order_id] = {
            "status": "success",
            "message": "Backend query succeeded",
            "display_order_id": display_order_id,
            "default_gift_id": default_gift_id,
            "userid": account.userid,
            "coupons_list": coupons_list,
            "coupon_by_id": {db_coupon.id: db_coupon for db_coupon in db_coupons},
            "change_map": change_map,
            "change_type": change_type,
        }

    results = []
    for code in request.coupon_codes:
        result = coupon_results.get(code) or {}
        coupon = result.get("coupon")
        is_old_code = result.get("is_from_history", False)

        if not coupon:
            results.append(CouponBackendQueryResponse(
                coupon_code=code,
                status="not_found",
                message="Coupon not found in database",
            ))
            continue

        order = order_map.get(coupon.order_id)
        if not order:
            results.append(CouponBackendQueryResponse(
                coupon_code=code,
                current_coupon_code=coupon.coupon_code,
                status="error",
                message="Order not found",
            ))
            continue

        account = account_map.get(order.account_id)
        if not account or not account.token:
            results.append(CouponBackendQueryResponse(
                coupon_code=code,
                current_coupon_code=coupon.coupon_code,
                order_view_id=order.order_view_id,
                status="error",
                message="Account token not available",
            ))
            continue

        context = order_api_context.get(order.id)
        if not context:
            results.append(CouponBackendQueryResponse(
                coupon_code=code,
                current_coupon_code=coupon.coupon_code,
                order_view_id=order.order_view_id,
                gift_id=coupon.gift_id or "-",
                userid=account.userid,
                coupon_status=coupon.coupon_status,
                verify_time="",
                verify_poi_name="",
                status="error",
                message="Order query context not available",
                is_old_code=is_old_code,
                code_changed=False,
                change_type="none",
                change_count=history_counts.get(coupon.id, 0),
            ))
            continue

        if context["status"] != "success":
            results.append(CouponBackendQueryResponse(
                coupon_code=code,
                current_coupon_code=coupon.coupon_code,
                order_view_id=context["display_order_id"],
                gift_id=coupon.gift_id or context["default_gift_id"],
                userid=context["userid"],
                coupon_status=coupon.coupon_status,
                verify_time="",
                verify_poi_name="",
                status=context["status"],
                message=context["message"],
                is_old_code=is_old_code,
                code_changed=False,
                change_type="none",
                change_count=history_counts.get(coupon.id, 0),
            ))
            continue

        current_coupon = context["coupon_by_id"].get(coupon.id, coupon)
        matched = None
        for api_coupon in context["coupons_list"]:
            api_code = api_coupon.get("coupon") or api_coupon.get("coupon_code")
            if api_code == current_coupon.coupon_code or api_coupon.get("encode") == current_coupon.encode:
                matched = api_coupon
                break

        change = context["change_map"].get(coupon.id)
        code_changed = change is not None
        old_coupon_code = change["old_code"] if change else None
        change_count = history_counts.get(coupon.id, 0) + (1 if code_changed else 0)
        display_gift_id = current_coupon.gift_id or context["default_gift_id"]

        if matched:
            results.append(CouponBackendQueryResponse(
                coupon_code=code,
                current_coupon_code=current_coupon.coupon_code,
                order_view_id=context["display_order_id"],
                gift_id=display_gift_id,
                userid=context["userid"],
                coupon_status=matched.get("order_status", ""),
                verify_time=matched.get("verifyTime", ""),
                verify_poi_name=matched.get("verifyPoiName", ""),
                status="found",
                message=context["message"],
                is_old_code=is_old_code,
                code_changed=code_changed,
                change_type=context["change_type"],
                old_coupon_code=old_coupon_code,
                change_count=change_count,
            ))
        else:
            results.append(CouponBackendQueryResponse(
                coupon_code=code,
                current_coupon_code=current_coupon.coupon_code,
                order_view_id=context["display_order_id"],
                gift_id=display_gift_id,
                userid=context["userid"],
                coupon_status=current_coupon.coupon_status,
                verify_time="",
                verify_poi_name="",
                status="partial",
                message="Coupon not matched in latest order result",
                is_old_code=is_old_code,
                code_changed=code_changed,
                change_type=context["change_type"],
                old_coupon_code=old_coupon_code,
                change_count=change_count,
            ))

    status_counts = defaultdict(int)
    for result in results:
        status_counts[result.status] += 1

    duration_ms = (time.perf_counter() - started_at) * 1000
    logger.info(
        "[P0][query_backend_grouped] input_count=%s unique_input_count=%s matched_order_count=%s grouped_order_count=%s api_call_attempts=%s api_call_successes=%s skipped_order_groups=%s applied_change_count=%s result_statuses=%s duration_ms=%.2f",
        len(request.coupon_codes),
        unique_input_codes,
        len(order_ids),
        len(order_coupons),
        api_call_attempts,
        api_call_successes,
        skipped_order_groups,
        applied_change_count,
        dict(status_counts),
        duration_ms,
    )

    return results


@router.get("", response_model=List[CouponResponse])
def get_coupons(
    skip: int = 0,
    limit: int = 100,
    account_id: int = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Coupon)
    if account_id:
        query = query.filter(Coupon.account_id == account_id)
    return query.order_by(Coupon.query_time.desc()).offset(skip).limit(limit).all()


@router.get("/{coupon_id}", response_model=CouponResponse)
def get_coupon(
    coupon_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    coupon = db.query(Coupon).filter(Coupon.id == coupon_id).first()
    if not coupon:
        raise HTTPException(status_code=404, detail="Coupon not found")
    return coupon


@router.post("/query", response_model=List[CouponQueryResponse])
def query_coupons(
    request: CouponQueryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    通过券码查询关联的订单和账号信息（优化版：支持旧券码匹配）
    返回账号信息供前端调用美团API获取最新券码状态
    """
    if not request.coupon_codes:
        return []
    coupon_results = batch_find_coupons_by_codes(db, request.coupon_codes)

    # 收集所有需要的 order_id 和 account_id
    order_ids = set()
    account_ids = set()

    for code, result in coupon_results.items():
        if result['coupon']:
            order_ids.add(result['coupon'].order_id)

    # 批量查询订单
    orders = db.query(Order).filter(Order.id.in_(order_ids)).all() if order_ids else []
    order_map = {o.id: o for o in orders}

    # 从订单中收集 account_id
    for order in orders:
        if order.account_id:
            account_ids.add(order.account_id)

    # 批量查询账号
    accounts = db.query(MTAccount).filter(MTAccount.id.in_(account_ids)).all() if account_ids else []
    account_map = {a.id: a for a in accounts}

    # 构建结果
    results = []
    for code in request.coupon_codes:
        result = coupon_results.get(code) or {}
        coupon = result.get('coupon')
        is_old_code = result.get('is_from_history', False)
        history = result.get('history')
        current_code = result.get('current_code', code)

        if not coupon:
            results.append(CouponQueryResponse(
                coupon_code=code,
                status="not_found",
                message="券码不存在"
            ))
            continue

        order = order_map.get(coupon.order_id)
        if not order:
            results.append(CouponQueryResponse(
                coupon_code=code,
                current_coupon_code=coupon.coupon_code,
                order_id=coupon.order_id,
                status="error",
                message="订单不存在"
            ))
            continue

        account = account_map.get(order.account_id)
        if not account:
            results.append(CouponQueryResponse(
                coupon_code=code,
                current_coupon_code=coupon.coupon_code,
                order_id=coupon.order_id,
                order_view_id=order.order_view_id,
                status="error",
                message="账号不存在"
            ))
            continue

        # 构建变更信息
        change_info = None
        if is_old_code and history:
            change_info = CouponChangeInfo(
                is_changed=True,
                change_count=1,
                old_coupon_code=history.old_coupon_code,
                last_change_time=history.changed_at
            )

        # 返回账号信息，供前端调用美团API
        results.append(CouponQueryResponse(
            coupon_code=code,  # 用户输入的券码
            current_coupon_code=coupon.coupon_code,  # 当前实际券码
            order_id=coupon.order_id,
            order_view_id=order.order_view_id,
            gift_id=coupon.gift_id,
            # 账号信息
            userid=account.userid,
            token=account.token,
            csecuuid=account.csecuuid,
            open_id=account.open_id,
            open_id_cipher=account.open_id_cipher,
            # 已有的券码状态
            coupon_status=coupon.coupon_status,
            status="found",
            message="已找到账号信息，可查询最新状态",
            raw_data=coupon.raw_data,
            # 变更信息
            is_old_code=is_old_code,
            change_info=change_info
        ))

    return results


@router.post("/query-backend", response_model=List[CouponBackendQueryResponse])
async def query_coupons_backend(
    request: CouponQueryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Backend coupon query with grouped order-level API calls.
    """
    if not request.coupon_codes:
        return []

    return await _query_coupons_backend_grouped(request, db)


@router.post("/batch-update")
def batch_update_coupons(
    request: CouponBatchUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    批量更新券码状态
    用于前端查询成功后批量更新数据库中的券码信息
    """
    if not request.coupons:
        return {"success": True, "updated": 0}

    # 提取所有券码
    coupon_codes = [c.coupon_code for c in request.coupons]

    # 批量查询券码
    coupons = db.query(Coupon).filter(Coupon.coupon_code.in_(coupon_codes)).all()
    coupon_map = {c.coupon_code: c for c in coupons}

    updated_count = 0
    for item in request.coupons:
        coupon = coupon_map.get(item.coupon_code)
        if coupon:
            # 更新券码状态
            if item.coupon_status is not None:
                coupon.coupon_status = item.coupon_status
            if item.use_status is not None:
                coupon.use_status = item.use_status
            coupon.query_time = datetime.now()
            updated_count += 1

    db.commit()

    return {
        "success": True,
        "updated": updated_count,
        "message": f"成功更新 {updated_count} 条券码记录"
    }


@router.get("/history/{coupon_id}")
def get_coupon_history(
    coupon_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取券码的变更历史
    """
    coupon = db.query(Coupon).filter(Coupon.id == coupon_id).first()
    if not coupon:
        raise HTTPException(status_code=404, detail="Coupon not found")

    histories = db.query(CouponHistory).filter(
        CouponHistory.coupon_id == coupon_id
    ).order_by(CouponHistory.changed_at.desc()).all()

    return {
        "coupon_id": coupon_id,
        "current_code": coupon.coupon_code,
        "history": [
            {
                "id": h.id,
                "old_code": h.old_coupon_code,
                "new_code": h.new_coupon_code,
                "changed_at": h.changed_at,
                "reason": h.change_reason
            }
            for h in histories
        ]
    }


@router.get("/detail/by-code/{coupon_code}")
def get_coupon_detail_by_code(
    coupon_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    通过券码获取完整详情（券码、账号、订单、变更历史）
    用于前端详情弹窗展示，一次请求获取所有信息
    """
    # 1. 查找券码（支持旧券码匹配）
    coupon, is_from_history, matched_history = find_coupon_by_code(db, coupon_code)

    if not coupon:
        raise HTTPException(status_code=404, detail="券码不存在")

    # 2. 查询关联订单
    order = db.query(Order).filter(Order.id == coupon.order_id).first()

    # 3. 查询关联账号
    account = None
    if order and order.account_id:
        account = db.query(MTAccount).filter(MTAccount.id == order.account_id).first()

    # 4. 查询变更历史
    histories = db.query(CouponHistory).filter(
        CouponHistory.coupon_id == coupon.id
    ).order_by(CouponHistory.changed_at.desc()).all()

    # 5. 构建返回数据
    result = {
        "coupon": {
            "id": coupon.id,
            "coupon_code": coupon.coupon_code,
            "encode": coupon.encode,
            "coupon_status": coupon.coupon_status,
            "use_status": coupon.use_status,
            "gift_id": coupon.gift_id,
            "query_time": coupon.query_time.isoformat() if coupon.query_time else None,
            "created_at": coupon.created_at.isoformat() if coupon.created_at else None,
            "updated_at": coupon.updated_at.isoformat() if coupon.updated_at else None,
        },
        "order": None,
        "account": None,
        "change_history": [],
        "is_old_code": is_from_history,
        "matched_history": None
    }

    # 订单信息
    if order:
        result["order"] = {
            "id": order.id,
            "order_id": order.order_id,
            "order_view_id": order.order_view_id,
            "title": order.title,
            "order_amount": float(order.order_amount) if order.order_amount else None,
            "commission_fee": float(order.commission_fee) if order.commission_fee else None,
            "total_coupon_num": order.total_coupon_num,
            "order_status": order.order_status,
            "showstatus": order.showstatus,
            "catename": order.catename,
            "is_gift": order.is_gift,
            "order_pay_time": order.order_pay_time.isoformat() if order.order_pay_time else None,
            "city_name": order.city_name,
            "consume_city_name": order.consume_city_name,
            "coupon_query_status": order.coupon_query_status,
        }

    # 账号信息（脱敏处理）
    if account:
        result["account"] = {
            "id": account.id,
            "remark": account.remark,
            "userid": account.userid,
            "status": account.status,
            "last_check_time": account.last_check_time.isoformat() if account.last_check_time else None,
            # token 不返回，安全考虑
        }

    # 变更历史
    result["change_history"] = [
        {
            "id": h.id,
            "old_coupon_code": h.old_coupon_code,
            "new_coupon_code": h.new_coupon_code,
            "changed_at": h.changed_at.isoformat() if h.changed_at else None,
            "change_reason": h.change_reason,
        }
        for h in histories
    ]

    # 匹配到的历史记录
    if matched_history:
        result["matched_history"] = {
            "old_coupon_code": matched_history.old_coupon_code,
            "new_coupon_code": matched_history.new_coupon_code,
            "changed_at": matched_history.changed_at.isoformat() if matched_history.changed_at else None,
        }

    return result
