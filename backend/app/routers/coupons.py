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
from app.models.order import Order
from app.models.account import MTAccount
from app.schemas.coupon import (
    CouponResponse, CouponQueryRequest, CouponQueryResponse,
    CouponBackendQueryResponse, CouponBatchUpdateRequest
)
from app.deps import get_current_user
from app.utils.encryption import decrypt_token

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
    通过券码查询关联的订单和账号信息（优化版：使用JOIN批量查询）
    返回账号信息供前端调用美团API获取最新券码状态
    """
    if not request.coupon_codes:
        return []

    # 批量查询所有券码，使用 JOIN 一次性获取关联的订单和账号信息
    coupons = db.query(Coupon).filter(
        Coupon.coupon_code.in_(request.coupon_codes)
    ).all()

    # 构建 coupon_code -> coupon 的映射
    coupon_map = {c.coupon_code: c for c in coupons}

    # 收集所有需要的 order_id 和 account_id
    order_ids = list(set(c.order_id for c in coupons if c.order_id))
    account_ids_from_coupons = list(set(c.account_id for c in coupons if c.account_id))

    # 批量查询订单
    orders = db.query(Order).filter(Order.id.in_(order_ids)).all() if order_ids else []
    order_map = {o.id: o for o in orders}

    # 从订单中收集 account_id
    account_ids_from_orders = list(set(o.account_id for o in orders if o.account_id))
    all_account_ids = list(set(account_ids_from_coupons + account_ids_from_orders))

    # 批量查询账号
    accounts = db.query(MTAccount).filter(MTAccount.id.in_(all_account_ids)).all() if all_account_ids else []
    account_map = {a.id: a for a in accounts}

    # 构建结果
    results = []
    for code in request.coupon_codes:
        coupon = coupon_map.get(code)

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
                order_id=coupon.order_id,
                status="error",
                message="订单不存在"
            ))
            continue

        account = account_map.get(order.account_id)
        if not account:
            results.append(CouponQueryResponse(
                coupon_code=code,
                order_id=coupon.order_id,
                order_view_id=order.order_view_id,
                status="error",
                message="账号不存在"
            ))
            continue

        # 返回账号信息，供前端调用美团API
        results.append(CouponQueryResponse(
            coupon_code=code,
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
            raw_data=coupon.raw_data
        ))

    return results


@router.post("/query-backend", response_model=List[CouponBackendQueryResponse])
async def query_coupons_backend(
    request: CouponQueryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    后端查询券码信息
    从数据库获取账号信息后，后端调用美团API获取最新券码状态
    """
    if not request.coupon_codes:
        return []

    # 批量查询所有券码
    coupons = db.query(Coupon).filter(
        Coupon.coupon_code.in_(request.coupon_codes)
    ).all()

    # 构建 coupon_code -> coupon 的映射
    coupon_map = {c.coupon_code: c for c in coupons}

    # 收集所有需要的 order_id
    order_ids = list(set(c.order_id for c in coupons if c.order_id))

    # 批量查询订单
    orders = db.query(Order).filter(Order.id.in_(order_ids)).all() if order_ids else []
    order_map = {o.id: o for o in orders}

    # 批量查询账号
    account_ids = list(set(o.account_id for o in orders if o.account_id))
    accounts = db.query(MTAccount).filter(MTAccount.id.in_(account_ids)).all() if account_ids else []
    account_map = {a.id: a for a in accounts}

    # 构建结果
    results = []
    for code in request.coupon_codes:
        coupon = coupon_map.get(code)

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
                status="error",
                message="订单不存在"
            ))
            continue

        account = account_map.get(order.account_id)
        if not account or not account.token:
            results.append(CouponBackendQueryResponse(
                coupon_code=code,
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

        # 调用美团API获取最新券码状态（使用解密后的Token）
        try:
            decrypted_token = decrypt_token(account.token)
            # 传递账号信息用于签名
            options = {
                "userId": account.userid or "",
                "openId": account.open_id or "",
                "uuid": account.csecuuid or ""
            }
            api_result = await call_meituan_api(decrypted_token, query_order_id, options)

            if api_result.get("success") and api_result.get("coupons"):
                coupons_list = api_result["coupons"]
                # 找到匹配的券码
                matched = None
                for c in coupons_list:
                    if c.get("coupon") == code or c.get("encode") == code:
                        matched = c
                        break

                if matched:
                    results.append(CouponBackendQueryResponse(
                        coupon_code=code,
                        order_view_id=display_order_id,
                        gift_id=display_gift_id,
                        userid=account.userid,
                        coupon_status=matched.get("order_status", ""),
                        verify_time=matched.get("verifyTime", ""),
                        verify_poi_name=matched.get("verifyPoiName", ""),
                        status="found",
                        message="后端API查询成功"
                    ))
                else:
                    # 券码未匹配，使用数据库中的状态
                    results.append(CouponBackendQueryResponse(
                        coupon_code=code,
                        order_view_id=display_order_id,
                        gift_id=display_gift_id,
                        userid=account.userid,
                        coupon_status=coupon.coupon_status,
                        verify_time="",
                        verify_poi_name="",
                        status="partial",
                        message="券码未在订单中找到"
                    ))
            else:
                # API调用失败，使用数据库中的状态
                error_msg = api_result.get("error", "未知错误")
                results.append(CouponBackendQueryResponse(
                    coupon_code=code,
                    order_view_id=display_order_id,
                    gift_id=display_gift_id,
                    userid=account.userid,
                    coupon_status=coupon.coupon_status,
                    verify_time="",
                    verify_poi_name="",
                    status="api_error",
                    message=f"美团API调用失败: {error_msg}"
                ))
        except Exception as e:
            results.append(CouponBackendQueryResponse(
                coupon_code=code,
                order_view_id=display_order_id,
                gift_id=display_gift_id,
                userid=account.userid,
                coupon_status=coupon.coupon_status,
                verify_time="",
                verify_poi_name="",
                status="error",
                message=f"查询异常: {str(e)}"
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
