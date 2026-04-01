from typing import List
import subprocess
import json
import os
import asyncio
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
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


async def call_meituan_api(token: str, order_id: str, options: dict = None) -> dict:
    """调用 Node.js 脚本查询美团API"""
    if options is None:
        options = {}

    # 获取脚本路径
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    script_path = os.path.join(base_dir, "services", "meituan", "meituanBackendApi.cjs")

    print(f"[DEBUG] Script path: {script_path}")
    print(f"[DEBUG] Script exists: {os.path.exists(script_path)}")

    if not os.path.exists(script_path):
        raise Exception(f"Script not found: {script_path}")

    args = json.dumps({
        "token": token,
        "orderId": order_id,
        "options": options
    })

    print(f"[DEBUG] Calling Node.js with orderId: {order_id}")

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
            print(f"[DEBUG] Node.js returncode: {result.returncode}")
            print(f"[DEBUG] Node.js stdout: {result.stdout[:500] if result.stdout else 'empty'}")
            print(f"[DEBUG] Node.js stderr: {result.stderr[:500] if result.stderr else 'empty'}")
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

    # 使用新的批量查询方法，同时匹配当前券码和历史旧券码
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
    后端查询券码信息（支持变码检测和处理）
    从数据库获取账号信息后，后端调用美团API获取最新券码状态
    自动检测券码变更并记录历史
    """
    if not request.coupon_codes:
        return []

    # 使用新的批量查询方法
    coupon_results = batch_find_coupons_by_codes(db, request.coupon_codes)

    # 收集所有需要的 order_id
    order_ids = set()
    for code, result in coupon_results.items():
        if result['coupon']:
            order_ids.add(result['coupon'].order_id)

    # 批量查询订单
    orders = db.query(Order).filter(Order.id.in_(order_ids)).all() if order_ids else []
    order_map = {o.id: o for o in orders}

    # 批量查询账号
    account_ids = set(o.account_id for o in orders if o.account_id)
    accounts = db.query(MTAccount).filter(MTAccount.id.in_(account_ids)).all() if account_ids else []
    account_map = {a.id: a for a in accounts}

    # 按订单分组券码，用于变码检测
    order_coupons = {}  # {order_id: [coupon_codes]}

    for code in request.coupon_codes:
        result = coupon_results.get(code)
        if result and result['coupon']:
            order_id = result['coupon'].order_id
            if order_id not in order_coupons:
                order_coupons[order_id] = []
            order_coupons[order_id].append(code)

    # 构建结果
    results = []

    for code in request.coupon_codes:
        result = coupon_results.get(code) or {}
        coupon = result.get('coupon')
        is_old_code = result.get('is_from_history', False)
        history = result.get('history')

        if not coupon:
            results.append(CouponBackendQueryResponse(
                coupon_code=code,
                status="not_found",
                message="券码不存在于数据库"
            ))
            continue

        order = order_map.get(coupon.order_id)
        if not order:
            results.append(CouponBackendQueryResponse(
                coupon_code=code,
                current_coupon_code=coupon.coupon_code,
                status="error",
                message="订单不存在"
            ))
            continue

        account = account_map.get(order.account_id)
        if not account or not account.token:
            results.append(CouponBackendQueryResponse(
                coupon_code=code,
                current_coupon_code=coupon.coupon_code,
                order_view_id=order.order_view_id,
                status="error",
                message="账号不存在或缺少token"
            ))
            continue

        # 通过位数判断订单号和礼物号
        id_str = str(order.order_view_id or '')
        is_gift_id = len(id_str) > 20 or id_str.startswith(('G', 'g'))

        display_order_id = '-' if is_gift_id else (order.order_view_id or '-')
        display_gift_id = id_str if is_gift_id else (coupon.gift_id or '-')

        # 确定查询用的订单号
        query_order_id = id_str if is_gift_id else order.order_view_id

        # 获取历史变更次数
        change_count = db.query(CouponHistory).filter(
            CouponHistory.coupon_id == coupon.id
        ).count()

        # 调用美团API获取最新券码状态
        try:
            decrypted_token = decrypt_token(account.token)
            options = {
                "userId": account.userid or "",
                "openId": account.open_id or "",
                "uuid": account.csecuuid or "c34d9b03-7520-47e3-9d7c-17a3d930c48d"
            }
            api_result = await call_meituan_api(decrypted_token, query_order_id, options)

            if api_result.get("success") and api_result.get("coupons"):
                coupons_list = api_result["coupons"]

                # 获取该订单的所有券码，进行变码检测
                db_coupons = db.query(Coupon).filter(
                    Coupon.order_id == coupon.order_id
                ).all()

                # 使用变更检测器
                detector = CouponChangeDetector(db_coupons, coupons_list)
                detection_result = detector.detect_changes()

                # 查找匹配的券码
                matched = None
                for c in coupons_list:
                    api_code = c.get("coupon") or c.get("coupon_code")
                    if api_code == coupon.coupon_code or c.get("encode") == coupon.encode:
                        matched = c
                        break

                # 确定变更类型
                code_changed = False
                change_type = 'none'
                old_coupon_code = None

                # 检查当前券码是否有变更
                for change in detection_result['changes']:
                    if change['db_coupon'].id == coupon.id:
                        code_changed = True
                        old_coupon_code = change['old_code']
                        break

                if detection_result['is_full_change']:
                    change_type = 'full'
                elif detection_result['is_partial_change']:
                    change_type = 'partial'

                # 如果有变更，应用到数据库
                if detection_result['changes']:
                    apply_coupon_changes(
                        db,
                        order.id,
                        order.account_id,
                        detection_result['changes']
                    )
                    # 刷新coupon对象
                    db.refresh(coupon)

                if matched:
                    results.append(CouponBackendQueryResponse(
                        coupon_code=code,
                        current_coupon_code=coupon.coupon_code,
                        order_view_id=display_order_id,
                        gift_id=display_gift_id,
                        userid=account.userid,
                        coupon_status=matched.get("order_status", ""),
                        verify_time=matched.get("verifyTime", ""),
                        verify_poi_name=matched.get("verifyPoiName", ""),
                        status="found",
                        message="后端API查询成功",
                        is_old_code=is_old_code,
                        code_changed=code_changed,
                        change_type=change_type,
                        old_coupon_code=old_coupon_code,
                        change_count=change_count
                    ))
                else:
                    # 券码未匹配但可能有变更
                    results.append(CouponBackendQueryResponse(
                        coupon_code=code,
                        current_coupon_code=coupon.coupon_code,
                        order_view_id=display_order_id,
                        gift_id=display_gift_id,
                        userid=account.userid,
                        coupon_status=coupon.coupon_status,
                        verify_time="",
                        verify_poi_name="",
                        status="partial",
                        message="券码未在订单中找到，可能已变更",
                        is_old_code=is_old_code,
                        code_changed=code_changed,
                        change_type=change_type,
                        old_coupon_code=old_coupon_code,
                        change_count=change_count
                    ))
            else:
                # API调用失败，使用数据库中的状态
                error_msg = api_result.get("error", "未知错误")
                results.append(CouponBackendQueryResponse(
                    coupon_code=code,
                    current_coupon_code=coupon.coupon_code,
                    order_view_id=display_order_id,
                    gift_id=display_gift_id,
                    userid=account.userid,
                    coupon_status=coupon.coupon_status,
                    verify_time="",
                    verify_poi_name="",
                    status="api_error",
                    message=f"美团API调用失败: {error_msg}",
                    is_old_code=is_old_code,
                    code_changed=False,
                    change_type='none',
                    change_count=change_count
                ))
        except Exception as e:
            results.append(CouponBackendQueryResponse(
                coupon_code=code,
                current_coupon_code=coupon.coupon_code,
                order_view_id=display_order_id,
                gift_id=display_gift_id,
                userid=account.userid,
                coupon_status=coupon.coupon_status,
                verify_time="",
                verify_poi_name="",
                status="error",
                message=f"查询异常: {str(e)}",
                is_old_code=is_old_code,
                code_changed=False,
                change_type='none',
                change_count=change_count
            ))

    return results


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
