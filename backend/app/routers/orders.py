from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from datetime import datetime
from app.database import get_db
from app.models.user import User
from app.models.order import Order
from app.models.coupon import Coupon
from app.models.account import MTAccount
from app.schemas.order import OrderResponse, OrderListResponse, OrderSaveRequest, CouponSaveRequest
from app.deps import get_current_user

router = APIRouter(prefix="/api/orders", tags=["orders"])

# 分批查询配置
IN_QUERY_BATCH_SIZE = 500  # IN查询每批最大数量


def batch_query_in(query_class, db: Session, filter_field, values: list, batch_size: int = IN_QUERY_BATCH_SIZE) -> list:
    """
    分批执行 IN 查询，避免单次查询数量过大
    Args:
        query_class: 查询的模型类
        db: 数据库会话
        filter_field: 过滤字段
        values: 要查询的值列表
        batch_size: 每批数量
    Returns:
        查询结果列表
    """
    if not values:
        return []

    results = []
    for i in range(0, len(values), batch_size):
        batch = values[i:i + batch_size]
        batch_results = db.query(query_class).filter(filter_field.in_(batch)).all()
        results.extend(batch_results)

    return results


@router.get("", response_model=OrderListResponse)
def get_orders(
    skip: int = 0,
    limit: int = 100,
    account_id: Optional[int] = None,
    status_filter: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Order)

    if account_id:
        query = query.filter(Order.account_id == account_id)

    # 状态筛选: 2=待使用, 3=已完成, 4=退款/售后
    if status_filter is not None:
        if status_filter == 2:
            # 待使用: order_status=1 或 showstatus 包含 "待消费"
            query = query.filter(
                (Order.order_status == 1) | (Order.showstatus.like('%待消费%'))
            )
        elif status_filter == 3:
            # 已完成: showstatus 包含 "已完成" 或 "待评价"
            query = query.filter(
                (Order.showstatus.like('%已完成%')) | (Order.showstatus.like('%待评价%'))
            )
        elif status_filter == 4:
            # 退款/售后
            query = query.filter(Order.showstatus.like('%退款%'))

    if start_date:
        query = query.filter(Order.order_pay_time >= datetime.fromisoformat(start_date))
    if end_date:
        query = query.filter(Order.order_pay_time <= datetime.fromisoformat(end_date))

    # 搜索功能：支持订单号和标题关键词搜索
    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            (Order.order_id.like(search_pattern)) | (Order.title.like(search_pattern))
        )

    total = query.count()
    items = query.order_by(Order.order_pay_time.desc()).offset(skip).limit(limit).all()

    return OrderListResponse(total=total, items=items)


@router.get("/ids")
def get_order_ids(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取订单ID集合（用于前端去重）
    仅返回 order_id 字段，数据量极小
    """
    ids = db.query(Order.order_id).filter(
        Order.account_id == account_id
    ).all()

    return {"ids": [id[0] for id in ids]}


@router.get("/pending-coupon-query")
def get_pending_coupon_query_orders(
    account_id: Optional[int] = None,
    status_filter: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取待查询券码的订单列表（用于券码查询功能）
    返回所有 coupon_query_status != 1 的订单
    只返回必要字段，减少数据传输量
    """
    query = db.query(
        Order.id,
        Order.order_view_id,
        Order.coupon_query_status
    ).filter(
        Order.coupon_query_status != 1  # 排除已成功查询的
    )

    if account_id:
        query = query.filter(Order.account_id == account_id)

    # 状态筛选
    if status_filter is not None:
        if status_filter == 2:
            query = query.filter(
                (Order.order_status == 1) | (Order.showstatus.like('%待消费%'))
            )
        elif status_filter == 3:
            query = query.filter(
                (Order.showstatus.like('%已完成%')) | (Order.showstatus.like('%待评价%'))
            )
        elif status_filter == 4:
            query = query.filter(Order.showstatus.like('%退款%'))

    # 只获取有 order_view_id 的订单
    query = query.filter(Order.order_view_id.isnot(None), Order.order_view_id != '')

    orders = query.order_by(Order.order_pay_time.desc()).all()

    return {
        "total": len(orders),
        "items": [
            {
                "id": o.id,
                "order_view_id": o.order_view_id,
                "coupon_query_status": o.coupon_query_status
            }
            for o in orders
        ]
    }


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.delete("/{order_id}")
def delete_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    db.delete(order)
    db.commit()
    return {"message": "Order deleted successfully"}


@router.post("/save-batch")
def save_orders_batch(
    request: OrderSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    批量保存订单 - 优化版
    使用批量查询和批量插入提高性能
    支持分批查询，避免 IN 查询数量过大
    """
    if not request.orders:
        return {"success": True, "new_count": 0, "update_count": 0}

    # 提取所有订单ID
    order_ids = [str(o.get('orderId', '')) for o in request.orders if o.get('orderId')]

    # 分批查询已存在的订单（优化：每批最多500个）
    existing_orders = []
    for i in range(0, len(order_ids), IN_QUERY_BATCH_SIZE):
        batch_ids = order_ids[i:i + IN_QUERY_BATCH_SIZE]
        batch_results = db.query(Order).filter(
            Order.account_id == request.account_id,
            Order.order_id.in_(batch_ids)
        ).all()
        existing_orders.extend(batch_results)

    # 构建已存在订单的映射
    existing_map = {o.order_id: o for o in existing_orders}

    new_count = 0
    update_count = 0
    new_orders = []

    for order_data in request.orders:
        order_id = str(order_data.get('orderId', ''))
        if not order_id:
            continue

        order_view_id = str(order_data.get('orderViewId', '')) if order_data.get('orderViewId') else None
        order_pay_time = order_data.get('orderPayTime')

        # 解析支付时间
        if order_pay_time:
            try:
                order_pay_time = datetime.fromisoformat(order_pay_time.replace('Z', '+00:00'))
            except:
                try:
                    order_pay_time = datetime.strptime(order_pay_time, '%Y-%m-%d %H:%M:%S')
                except:
                    try:
                        order_pay_time = datetime.strptime(order_pay_time, '%Y-%m-%d %H:%M')
                    except:
                        try:
                            order_pay_time = datetime.strptime(order_pay_time, '%Y-%m-%d')
                        except:
                            order_pay_time = None
        else:
            order_pay_time = None

        if order_id in existing_map:
            # 更新现有订单
            existing = existing_map[order_id]
            existing.order_view_id = order_view_id
            existing.title = order_data.get('title')
            existing.order_amount = order_data.get('orderAmount')
            existing.commission_fee = order_data.get('commissionFee')
            existing.total_coupon_num = order_data.get('totalCouponNum')
            existing.order_status = order_data.get('tousestatus') or order_data.get('orderStatus')
            existing.showstatus = order_data.get('showstatus')
            existing.catename = order_data.get('catename')
            existing.is_gift = order_data.get('isGift', False)
            existing.order_pay_time = order_pay_time
            existing.city_name = order_data.get('cityName')
            existing.consume_city_name = order_data.get('consumeCityName')
            update_count += 1
        else:
            # 创建新订单对象
            new_order = Order(
                account_id=request.account_id,
                order_id=order_id,
                order_view_id=order_view_id,
                title=order_data.get('title'),
                order_amount=order_data.get('orderAmount'),
                commission_fee=order_data.get('commissionFee'),
                total_coupon_num=order_data.get('totalCouponNum'),
                order_status=order_data.get('tousestatus') or order_data.get('orderStatus'),
                showstatus=order_data.get('showstatus'),
                catename=order_data.get('catename'),
                is_gift=order_data.get('isGift', False),
                order_pay_time=order_pay_time,
                city_name=order_data.get('cityName'),
                consume_city_name=order_data.get('consumeCityName')
            )
            new_orders.append(new_order)
            new_count += 1

    # 批量插入新订单
    if new_orders:
        db.bulk_save_objects(new_orders)

    db.commit()

    return {
        "success": True,
        "new_count": new_count,
        "update_count": update_count
    }


@router.post("/save-coupon")
def save_coupon(
    request: CouponSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    保存券码信息
    - 如果券码已存在（按 coupon_code 判断），则更新
    - 如果券码不存在，则新增
    """
    # 查询订单是否存在
    order = db.query(Order).filter(Order.id == request.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    coupon_data = request.coupon_data or {}

    # 从 coupon_data 中提取券码信息
    # 数据结构: { coupon, encode, couponId, status, order_status, useStatus, title, mobile, payPrice }
    coupon_code = coupon_data.get('coupon') or coupon_data.get('couponCode')
    encode = coupon_data.get('encode')
    coupon_status = coupon_data.get('order_status') or coupon_data.get('couponStatus') or coupon_data.get('statusText')
    use_status = coupon_data.get('useStatus')  # 1=待使用, 3=已使用
    gift_id = coupon_data.get('giftId')  # 礼物订单可能有单独的 giftId

    # 如果没有 coupon_code 但有 encode，使用 encode
    if not coupon_code and encode:
        coupon_code = encode

    if not coupon_code:
        return {
            "success": False,
            "message": "No coupon code found"
        }

    # 查询是否已存在相同券码记录（按 order_id + coupon_code）
    existing = db.query(Coupon).filter(
        Coupon.order_id == request.order_id,
        Coupon.coupon_code == coupon_code
    ).first()

    if existing:
        # 更新现有券码
        existing.encode = encode
        existing.coupon_status = coupon_status
        existing.use_status = use_status
        existing.gift_id = gift_id
        existing.raw_data = request.raw_data
        existing.query_time = datetime.now()
    else:
        # 创建新券码
        new_coupon = Coupon(
            order_id=request.order_id,
            account_id=request.account_id,
            coupon_code=coupon_code,
            encode=encode,
            coupon_status=coupon_status,
            use_status=use_status,
            gift_id=gift_id,
            raw_data=request.raw_data
        )
        db.add(new_coupon)

    # 同时更新订单的券码查询状态为成功
    order.coupon_query_status = 1

    db.commit()

    return {
        "success": True,
        "message": "Coupon saved successfully"
    }


@router.post("/update-query-status")
def update_query_status(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    批量更新订单的券码查询状态
    data: { order_ids: [1, 2, 3], status: 1 }  # status: 0=待查询, 1=成功, 2=失败
    优化：分批更新，避免 IN 查询数量过大
    """
    order_ids = data.get("order_ids", [])
    status_value = data.get("status", 0)

    if not order_ids:
        return {"success": True, "updated": 0}

    # 分批更新
    total_updated = 0
    for i in range(0, len(order_ids), IN_QUERY_BATCH_SIZE):
        batch_ids = order_ids[i:i + IN_QUERY_BATCH_SIZE]
        updated = db.query(Order).filter(Order.id.in_(batch_ids)).update(
            {Order.coupon_query_status: status_value},
            synchronize_session=False
        )
        total_updated += updated

    db.commit()

    return {"success": True, "updated": total_updated}


@router.post("/query-by-order-id")
async def query_order_by_order_id(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    通过订单号查询券码信息（后端调用美团API）
    如果订单不存在，自动创建订单并保存券码
    """
    import asyncio
    import subprocess
    import json
    import os
    from app.utils.encryption import decrypt_token

    account_id = data.get("account_id")
    order_id = data.get("order_id")

    if not account_id or not order_id:
        return {"success": False, "message": "缺少账号ID或订单号"}

    # 获取账号信息
    account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not account:
        return {"success": False, "message": "账号不存在"}

    # 调用 Node.js 脚本查询美团API
    try:
        token = decrypt_token(account.token)

        # 获取脚本路径
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        script_path = os.path.join(base_dir, "services", "meituan", "meituanBackendApi.cjs")

        if not os.path.exists(script_path):
            return {"success": False, "message": "脚本文件不存在"}

        args = json.dumps({
            "token": token,
            "orderId": order_id,
            "options": {
                "userId": account.userid or "",
                "openId": account.open_id or "",
                "uuid": account.csecuuid or ""
            }
        })

        def run_subprocess():
            result = subprocess.run(
                ["node", script_path, "getCouponList", args],
                capture_output=True,
                timeout=30,
                encoding='utf-8',
                errors='replace'
            )
            if result.returncode != 0:
                raise Exception(result.stderr or "Node.js 执行失败")
            lines = result.stdout.strip().split('\n')
            json_line = lines[-1] if lines else result.stdout
            return json.loads(json_line)

        api_result = await asyncio.to_thread(run_subprocess)

        if not api_result.get("success"):
            return {"success": False, "message": api_result.get("error", "查询失败")}

        coupons = api_result.get("coupons", [])

        # 查询或创建订单
        order = db.query(Order).filter(
            Order.account_id == account_id,
            Order.order_id == order_id
        ).first()

        if not order:
            # 创建新订单
            order = Order(
                account_id=account_id,
                order_id=order_id,
                order_view_id=order_id,
                title=coupons[0].get("title", "") if coupons else "",
                order_status=1,
                coupon_query_status=1 if coupons else 2
            )
            db.add(order)
            db.flush()
        else:
            order.coupon_query_status = 1 if coupons else 2

        # 保存券码
        for coupon_info in coupons:
            coupon_code = coupon_info.get("coupon") or coupon_info.get("encode")
            if not coupon_code:
                continue

            # 检查券码是否已存在
            existing_coupon = db.query(Coupon).filter(
                Coupon.order_id == order.id,
                Coupon.coupon_code == coupon_code
            ).first()

            if existing_coupon:
                # 更新现有券码
                existing_coupon.coupon_status = coupon_info.get("order_status", "")
                existing_coupon.use_status = coupon_info.get("useStatus")
                existing_coupon.query_time = datetime.now()
            else:
                # 创建新券码
                new_coupon = Coupon(
                    order_id=order.id,
                    account_id=account_id,
                    coupon_code=coupon_code,
                    encode=coupon_info.get("encode", ""),
                    coupon_status=coupon_info.get("order_status", ""),
                    use_status=coupon_info.get("useStatus"),
                    raw_data={"data": coupons}
                )
                db.add(new_coupon)

        db.commit()

        return {
            "success": True,
            "coupons": coupons,
            "message": f"查询成功，获取到 {len(coupons)} 个券码",
            "saved": True
        }

    except subprocess.TimeoutExpired:
        return {"success": False, "message": "查询超时"}
    except json.JSONDecodeError as e:
        return {"success": False, "message": f"解析响应失败: {str(e)}"}
    except Exception as e:
        return {"success": False, "message": f"查询异常: {str(e)}"}
