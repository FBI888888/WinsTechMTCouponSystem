import logging
import threading
import time
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import and_, or_
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from datetime import datetime
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.models.order import Order
from app.models.coupon import Coupon
from app.models.account import MTAccount
from app.schemas.order import (
    OrderResponse,
    OrderListResponse,
    OrderSaveRequest,
    CouponSaveRequest,
    PendingCouponQueryResponse,
)
from app.deps import get_current_user
from app.routers.stats import invalidate_dashboard_stats_cache
from app.utils.order_status import (
    COMPLETED_STATUS_BUCKET,
    PENDING_STATUS_BUCKET,
    REFUND_STATUS_BUCKET,
    normalize_order_status_bucket,
)

router = APIRouter(prefix="/api/orders", tags=["orders"])
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# 鍒嗘壒鏌ヨ閰嶇疆
IN_QUERY_BATCH_SIZE = 500  # IN鏌ヨ姣忔壒鏈€澶ф暟閲?
ORDER_SEARCH_PREFIX_MIN_LENGTH = 6
_order_count_cache_lock = threading.Lock()
_order_count_cache = {}


def batch_query_in(query_class, db: Session, filter_field, values: list, batch_size: int = IN_QUERY_BATCH_SIZE) -> list:
    """
    鍒嗘壒鎵ц IN 鏌ヨ锛岄伩鍏嶅崟娆℃煡璇㈡暟閲忚繃澶?
    Args:
        query_class: 鏌ヨ鐨勬ā鍨嬬被
        db: 鏁版嵁搴撲細璇?
        filter_field: 杩囨护瀛楁
        values: 瑕佹煡璇㈢殑鍊煎垪琛?
        batch_size: 姣忔壒鏁伴噺
    Returns:
        鏌ヨ缁撴灉鍒楄〃
    """
    if not values:
        return []

    results = []
    for i in range(0, len(values), batch_size):
        batch = values[i:i + batch_size]
        batch_results = db.query(query_class).filter(filter_field.in_(batch)).all()
        results.extend(batch_results)

    return results


def invalidate_order_list_count_cache() -> None:
    with _order_count_cache_lock:
        _order_count_cache.clear()


def _apply_order_search_filter(query, normalized_search: str):
    exact_match_filter = or_(
        Order.order_id == normalized_search,
        Order.order_view_id == normalized_search,
    )

    if normalized_search.isdigit():
        if len(normalized_search) >= ORDER_SEARCH_PREFIX_MIN_LENGTH:
            return (
                query.filter(
                    or_(
                        exact_match_filter,
                        Order.order_id.like(f"{normalized_search}%"),
                        Order.order_view_id.like(f"{normalized_search}%"),
                    )
                ),
                "numeric_exact_or_prefix",
            )

        return query.filter(exact_match_filter), "numeric_exact_only"

    search_prefix = f"{normalized_search}%"
    search_pattern = f"%{normalized_search}%"
    return (
        query.filter(
            or_(
                exact_match_filter,
                Order.order_id.like(search_prefix),
                Order.order_view_id.like(search_prefix),
                Order.title.like(search_pattern),
            )
        ),
        "text_prefix_or_title",
    )


def _apply_explicit_order_search_filter(query, order_keyword: str, order_search_mode: str = "exact"):
    exact_match_filter = or_(
        Order.order_id == order_keyword,
        Order.order_view_id == order_keyword,
    )

    if order_search_mode == "exact":
        return query.filter(exact_match_filter), "order_exact"

    if (
        order_search_mode == "prefix"
        and order_keyword.isdigit()
        and len(order_keyword) >= ORDER_SEARCH_PREFIX_MIN_LENGTH
    ):
        return (
            query.filter(
                or_(
                    exact_match_filter,
                    Order.order_id.like(f"{order_keyword}%"),
                    Order.order_view_id.like(f"{order_keyword}%"),
                )
            ),
            "order_exact_or_prefix",
        )

    return query.filter(exact_match_filter), "order_exact_fallback"


def _build_order_filters(
    query,
    account_id: Optional[int] = None,
    status_filter: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    order_search: Optional[str] = None,
    title_search: Optional[str] = None,
    order_search_mode: str = "exact",
):
    search_strategy = "none"

    if account_id:
        query = query.filter(Order.account_id == account_id)

    if status_filter == 2:
        query = query.filter(Order.order_status_bucket == PENDING_STATUS_BUCKET)
    elif status_filter == 3:
        query = query.filter(Order.order_status_bucket == COMPLETED_STATUS_BUCKET)
    elif status_filter == 4:
        query = query.filter(Order.order_status_bucket == REFUND_STATUS_BUCKET)

    if start_date:
        query = query.filter(Order.order_pay_time >= datetime.fromisoformat(start_date))
    if end_date:
        query = query.filter(Order.order_pay_time <= datetime.fromisoformat(end_date))

    if order_search:
        normalized_order_search = order_search.strip()
        if normalized_order_search:
            query, search_strategy = _apply_explicit_order_search_filter(
                query,
                normalized_order_search,
                order_search_mode=order_search_mode,
            )

    if title_search:
        normalized_title_search = title_search.strip()
        if normalized_title_search:
            query = query.filter(Order.title.like(f"%{normalized_title_search}%"))
            search_strategy = (
                f"{search_strategy}+title_contains"
                if search_strategy != "none"
                else "title_contains"
            )

    if search and search_strategy == "none":
        normalized_search = search.strip()
        if normalized_search:
            query, search_strategy = _apply_order_search_filter(query, normalized_search)

    return query, search_strategy


def _get_order_count_cache_key(
    account_id: Optional[int],
    status_filter: Optional[int],
    start_date: Optional[str],
    end_date: Optional[str],
    search: Optional[str],
    order_search: Optional[str],
    title_search: Optional[str],
    order_search_mode: str,
) -> tuple:
    return (
        account_id,
        status_filter,
        start_date or "",
        end_date or "",
        (search or "").strip(),
        (order_search or "").strip(),
        (title_search or "").strip(),
        order_search_mode,
    )


def _get_cached_order_count(cache_key: tuple) -> Optional[int]:
    now = time.time()
    with _order_count_cache_lock:
        cached = _order_count_cache.get(cache_key)
        if not cached:
            return None
        if now >= cached["expires_at"]:
            _order_count_cache.pop(cache_key, None)
            return None
        return cached["value"]


def _set_cached_order_count(cache_key: tuple, total: int) -> None:
    with _order_count_cache_lock:
        _order_count_cache[cache_key] = {
            "value": total,
            "expires_at": time.time() + settings.ORDER_LIST_COUNT_CACHE_TTL_SECONDS,
        }


def _parse_cursor_order_pay_time(raw_value: Optional[str]) -> Optional[datetime]:
    if not raw_value:
        return None

    normalized = raw_value.strip()
    if not normalized:
        return None

    return datetime.fromisoformat(normalized.replace("Z", "+00:00"))


@router.get("", response_model=OrderListResponse)
def get_orders(
    skip: int = 0,
    limit: int = 100,
    account_id: Optional[int] = None,
    status_filter: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    order_search: Optional[str] = None,
    title_search: Optional[str] = None,
    order_search_mode: str = Query("exact", pattern="^(exact|prefix)$"),
    include_total: bool = True,
    known_total: Optional[int] = None,
    cursor_order_pay_time: Optional[str] = None,
    cursor_id: Optional[int] = None,
    cursor_direction: str = Query("next", pattern="^(next|prev)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    started_at = time.perf_counter()

    base_query, search_strategy = _build_order_filters(
        db.query(Order),
        account_id=account_id,
        status_filter=status_filter,
        start_date=start_date,
        end_date=end_date,
        search=search,
        order_search=order_search,
        title_search=title_search,
        order_search_mode=order_search_mode,
    )

    parsed_cursor_order_pay_time = _parse_cursor_order_pay_time(cursor_order_pay_time)
    use_cursor_pagination = parsed_cursor_order_pay_time is not None and cursor_id is not None
    total = known_total if not include_total and known_total is not None else None
    count_cache_hit = False
    count_skipped = not include_total

    if total is None:
        cache_key = _get_order_count_cache_key(
            account_id,
            status_filter,
            start_date,
            end_date,
            search,
            order_search,
            title_search,
            order_search_mode,
        )
        total = _get_cached_order_count(cache_key)
        count_cache_hit = total is not None
        if total is None:
            total = base_query.order_by(None).count()
            _set_cached_order_count(cache_key, total)

    page_query = base_query
    pagination_mode = "offset"
    fetch_limit = limit + 1

    if use_cursor_pagination:
        pagination_mode = "cursor"
        if cursor_direction == "prev":
            page_query = page_query.filter(
                or_(
                    Order.order_pay_time > parsed_cursor_order_pay_time,
                    and_(
                        Order.order_pay_time == parsed_cursor_order_pay_time,
                        Order.id > cursor_id,
                    ),
                )
            ).order_by(Order.order_pay_time.asc(), Order.id.asc())
        else:
            page_query = page_query.filter(
                or_(
                    Order.order_pay_time < parsed_cursor_order_pay_time,
                    and_(
                        Order.order_pay_time == parsed_cursor_order_pay_time,
                        Order.id < cursor_id,
                    ),
                )
            ).order_by(Order.order_pay_time.desc(), Order.id.desc())
        items = page_query.limit(fetch_limit).all()
        has_more = len(items) > limit
        if has_more:
            items = items[:limit]
        if cursor_direction == "prev":
            items = list(reversed(items))
    else:
        items = (
            page_query
            .order_by(Order.order_pay_time.desc(), Order.id.desc())
            .offset(skip)
            .limit(fetch_limit)
            .all()
        )
        has_more = len(items) > limit
        if has_more:
            items = items[:limit]

    next_cursor_order_pay_time = None
    next_cursor_id = None
    prev_cursor_order_pay_time = None
    prev_cursor_id = None
    if items:
        first_item = items[0]
        last_item = items[-1]
        if first_item.order_pay_time is not None:
            prev_cursor_order_pay_time = first_item.order_pay_time
            prev_cursor_id = first_item.id
        if last_item.order_pay_time is not None:
            next_cursor_order_pay_time = last_item.order_pay_time
            next_cursor_id = last_item.id

    if total is None:
        total = len(items)

    duration_ms = (time.perf_counter() - started_at) * 1000
    logger.info(
        "[P1][orders_list] account_id=%s status_filter=%s skip=%s limit=%s search=%s search_strategy=%s total=%s include_total=%s count_skipped=%s count_cache_hit=%s pagination_mode=%s cursor_direction=%s has_more=%s duration_ms=%.2f",
        account_id,
        status_filter,
        skip,
        limit,
        bool(search),
        search_strategy,
        total,
        include_total,
        count_skipped,
        count_cache_hit,
        pagination_mode,
        cursor_direction if use_cursor_pagination else None,
        has_more,
        duration_ms,
    )

    return OrderListResponse(
        total=total,
        has_more=has_more,
        pagination_mode=pagination_mode,
        next_cursor_order_pay_time=next_cursor_order_pay_time,
        next_cursor_id=next_cursor_id,
        prev_cursor_order_pay_time=prev_cursor_order_pay_time,
        prev_cursor_id=prev_cursor_id,
        items=items,
    )


@router.get("/pending-coupon-query", response_model=PendingCouponQueryResponse)
def get_pending_coupon_query_orders(
    account_id: Optional[int] = None,
    status_filter: Optional[int] = None,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    鑾峰彇寰呮煡璇㈠埜鐮佺殑璁㈠崟鍒楄〃锛堢敤浜庡埜鐮佹煡璇㈠姛鑳斤級
    杩斿洖鎵€鏈?coupon_query_status != 1 鐨勮鍗?
    鍙繑鍥炲繀瑕佸瓧娈碉紝鍑忓皯鏁版嵁浼犺緭閲?
    """
    started_at = time.perf_counter()

    query = db.query(
        Order.id,
        Order.order_view_id,
        Order.coupon_query_status
    ).filter(
        Order.coupon_query_status != 1  # 鎺掗櫎宸叉垚鍔熸煡璇㈢殑
    )

    if account_id:
        query = query.filter(Order.account_id == account_id)

    # 鐘舵€佺瓫閫?
    if status_filter is not None:
        if status_filter == 2:
            query = query.filter(Order.order_status_bucket == PENDING_STATUS_BUCKET)
        elif status_filter == 3:
            query = query.filter(Order.order_status_bucket == COMPLETED_STATUS_BUCKET)
        elif status_filter == 4:
            query = query.filter(Order.order_status_bucket == REFUND_STATUS_BUCKET)
    query = query.filter(Order.order_view_id.isnot(None), Order.order_view_id != '')

    orders = query.order_by(Order.order_pay_time.desc(), Order.id.desc()).limit(limit + 1).all()
    has_more = len(orders) > limit
    if has_more:
        orders = orders[:limit]

    response = {
        "returned_count": len(orders),
        "has_more": has_more,
        "total": len(orders) + (1 if has_more else 0),
        "items": [
            {
                "id": o.id,
                "order_view_id": o.order_view_id,
                "coupon_query_status": o.coupon_query_status
            }
            for o in orders
        ]
    }

    duration_ms = (time.perf_counter() - started_at) * 1000
    logger.info(
        "[P0][pending_coupon_query] account_id=%s status_filter=%s limit=%s returned_count=%s has_more=%s duration_ms=%.2f",
        account_id,
        status_filter,
        limit,
        response["returned_count"],
        response["has_more"],
        duration_ms,
    )

    return response



@router.get("/existing-ids")
def get_existing_order_ids(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取账号所有已存储的订单ID及状态，用于前端本地去重比对。
    只返回轻量字段（order_id / order_status / showstatus），避免全字段传输。
    """
    rows = (
        db.query(Order.order_id, Order.order_status, Order.showstatus)
        .filter(Order.account_id == account_id)
        .all()
    )
    return {r.order_id: {"order_status": r.order_status, "showstatus": r.showstatus} for r in rows}

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
    invalidate_order_list_count_cache()
    invalidate_dashboard_stats_cache()
    return {"message": "Order deleted successfully"}

@router.post("/save-batch")
def save_orders_batch(
    request: OrderSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    批量保存订单（MySQL upsert 版）
    使用 INSERT ... ON DUPLICATE KEY UPDATE 替代 SELECT-then-UPDATE，
    单条 SQL 完成新增 + 更新，避免逐行 ORM dirty tracking。
    注意：coupon_query_status 不在 ON DUPLICATE KEY UPDATE 列中，扫描状态不会被覆盖。
    """
    started_at = time.perf_counter()
    input_count = len(request.orders)

    if not request.orders:
        return {"success": True, "new_count": 0, "update_count": 0, "skip_count": 0}

    # 批内去重：同一批中重复 order_id 保留最后一条
    normalized_orders = {}
    skip_count = 0
    for order_data in request.orders:
        order_id = str(order_data.get('orderId', '')).strip()
        if not order_id:
            skip_count += 1
            continue
        if order_id in normalized_orders:
            skip_count += 1
        normalized_orders[order_id] = order_data

    if not normalized_orders:
        return {"success": True, "new_count": 0, "update_count": 0, "skip_count": skip_count}

    def parse_pay_time(raw):
        if not raw:
            return None
        for fmt in (None, '%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d'):
            try:
                if fmt is None:
                    return datetime.fromisoformat(raw.replace('Z', '+00:00'))
                return datetime.strptime(raw, fmt)
            except (ValueError, AttributeError):
                continue
        return None

    rows = []
    for order_id, order_data in normalized_orders.items():
        order_view_id = str(order_data.get('orderViewId', '')) or None
        normalized_order_status = order_data.get('tousestatus') or order_data.get('orderStatus')
        normalized_showstatus = order_data.get('showstatus')
        rows.append({
            'account_id': request.account_id,
            'order_id': order_id,
            'order_view_id': order_view_id,
            'title': order_data.get('title'),
            'order_amount': order_data.get('orderAmount'),
            'commission_fee': order_data.get('commissionFee'),
            'total_coupon_num': order_data.get('totalCouponNum'),
            'order_status': normalized_order_status,
            'order_status_bucket': normalize_order_status_bucket(normalized_order_status, normalized_showstatus),
            'showstatus': normalized_showstatus,
            'catename': order_data.get('catename'),
            'is_gift': order_data.get('isGift', False),
            'order_pay_time': parse_pay_time(order_data.get('orderPayTime')),
            'city_name': order_data.get('cityName'),
            'consume_city_name': order_data.get('consumeCityName'),
        })

    try:
        # INSERT IGNORE：已存在（唯一键冲突）直接跳过，只插入新行
        # 不需要 COUNT 查询，rowcount 就是实际插入数
        stmt = mysql_insert(Order).prefix_with("IGNORE").values(rows)
        result = db.execute(stmt)
        db.commit()

        invalidate_order_list_count_cache()
        invalidate_dashboard_stats_cache()

        new_count = result.rowcount
        response = {
            "success": True,
            "new_count": new_count,
            "update_count": 0,
            "skip_count": skip_count + (len(rows) - new_count),
        }

        duration_ms = (time.perf_counter() - started_at) * 1000
        logger.info(
            "[save_orders_batch] account_id=%s input=%s insert_ignore=%s new=%s skip=%s duration_ms=%.1f",
            request.account_id, input_count, len(rows),
            new_count, response["skip_count"], duration_ms,
        )
        return response

    except SQLAlchemyError as exc:
        db.rollback()
        duration_ms = (time.perf_counter() - started_at) * 1000
        logger.exception(
            "[save_orders_batch_error] account_id=%s input=%s duration_ms=%.1f error=%s",
            request.account_id, input_count, duration_ms, exc,
        )
        raise HTTPException(
            status_code=500,
            detail="批量保存订单失败，请稍后重试；如果持续失败，请检查数据库连接超时配置。"
        ) from exc


@router.post("/save-coupon")
def save_coupon(
    request: CouponSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    淇濆瓨鍒哥爜淇℃伅
    - 濡傛灉鍒哥爜宸插瓨鍦紙鎸?coupon_code 鍒ゆ柇锛夛紝鍒欐洿鏂?
    - 濡傛灉鍒哥爜涓嶅瓨鍦紝鍒欐柊澧?
    """
    # 鏌ヨ璁㈠崟鏄惁瀛樺湪
    order = db.query(Order).filter(Order.id == request.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    coupon_data = request.coupon_data or {}

    # 浠?coupon_data 涓彁鍙栧埜鐮佷俊鎭?
    # 鏁版嵁缁撴瀯: { coupon, encode, couponId, status, order_status, useStatus, title, mobile, payPrice }
    coupon_code = coupon_data.get('coupon') or coupon_data.get('couponCode')
    encode = coupon_data.get('encode')
    coupon_status = coupon_data.get('order_status') or coupon_data.get('couponStatus') or coupon_data.get('statusText')
    use_status = coupon_data.get('useStatus')  # 1=寰呬娇鐢? 3=宸蹭娇鐢?
    gift_id = coupon_data.get('giftId')  # 绀肩墿璁㈠崟鍙兘鏈夊崟鐙殑 giftId

    # 濡傛灉娌℃湁 coupon_code 浣嗘湁 encode锛屼娇鐢?encode
    if not coupon_code and encode:
        coupon_code = encode

    if not coupon_code:
        return {
            "success": False,
            "message": "No coupon code found"
        }

    # 鏌ヨ鏄惁宸插瓨鍦ㄧ浉鍚屽埜鐮佽褰曪紙鎸?order_id + coupon_code锛?
    existing = db.query(Coupon).filter(
        Coupon.order_id == request.order_id,
        Coupon.coupon_code == coupon_code
    ).first()

    if existing:
        # 鏇存柊鐜版湁鍒哥爜
        existing.encode = encode
        existing.coupon_status = coupon_status
        existing.use_status = use_status
        existing.gift_id = gift_id
        existing.raw_data = request.raw_data
        existing.query_time = datetime.now()
    else:
        # 鍒涘缓鏂板埜鐮?
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

    # 鍚屾椂鏇存柊璁㈠崟鐨勫埜鐮佹煡璇㈢姸鎬佷负鎴愬姛
    order.coupon_query_status = 1

    db.commit()
    invalidate_order_list_count_cache()
    invalidate_dashboard_stats_cache()

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
    鎵归噺鏇存柊璁㈠崟鐨勫埜鐮佹煡璇㈢姸鎬?
    data: { order_ids: [1, 2, 3], status: 1 }  # status: 0=寰呮煡璇? 1=鎴愬姛, 2=澶辫触
    浼樺寲锛氬垎鎵规洿鏂帮紝閬垮厤 IN 鏌ヨ鏁伴噺杩囧ぇ
    """
    order_ids = data.get("order_ids", [])
    status_value = data.get("status", 0)

    if not order_ids:
        return {"success": True, "updated": 0}

    # 鍒嗘壒鏇存柊
    total_updated = 0
    for i in range(0, len(order_ids), IN_QUERY_BATCH_SIZE):
        batch_ids = order_ids[i:i + IN_QUERY_BATCH_SIZE]
        updated = db.query(Order).filter(Order.id.in_(batch_ids)).update(
            {Order.coupon_query_status: status_value},
            synchronize_session=False
        )
        total_updated += updated

    db.commit()
    invalidate_order_list_count_cache()
    invalidate_dashboard_stats_cache()

    return {"success": True, "updated": total_updated}


@router.post("/update-gift-return-status")
def update_gift_return_status(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    批量更新订单的礼物退还状态。
    data: { order_ids: [1, 2], status: 1, message: "礼物退还成功" }
    status: 0=未处理, 1=成功, 2=风控, 3=失败, 4=处理中
    """
    order_ids = data.get("order_ids", [])
    status_value = int(data.get("status", 0))
    message = data.get("message")
    normalized_message = str(message).strip()[:255] if message is not None else None

    if not order_ids:
        return {"success": True, "updated": 0}

    update_values = {
        Order.gift_return_status: status_value,
        Order.gift_return_updated_at: datetime.now(),
        Order.updated_at: datetime.now(),
    }
    update_values[Order.gift_return_message] = normalized_message

    total_updated = 0
    for i in range(0, len(order_ids), IN_QUERY_BATCH_SIZE):
        batch_ids = order_ids[i:i + IN_QUERY_BATCH_SIZE]
        updated = db.query(Order).filter(Order.id.in_(batch_ids)).update(
            update_values,
            synchronize_session=False
        )
        total_updated += updated

    db.commit()
    invalidate_order_list_count_cache()
    invalidate_dashboard_stats_cache()

    return {"success": True, "updated": total_updated}


@router.post("/query-by-order-id")
async def query_order_by_order_id(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    閫氳繃璁㈠崟鍙锋煡璇㈠埜鐮佷俊鎭紙鍚庣璋冪敤缇庡洟API锛?    濡傛灉璁㈠崟涓嶅瓨鍦紝鑷姩鍒涘缓璁㈠崟骞朵繚瀛樺埜鐮?    """
    from app.services.meituan.scanner import task_service

    account_id = data.get("account_id")
    order_id = data.get("order_id")

    if not account_id or not order_id:
        return {"success": False, "message": "缂哄皯璐﹀彿ID鎴栬鍗曞彿"}

    # 鑾峰彇璐﹀彿淇℃伅
    account = db.query(MTAccount).filter(MTAccount.id == account_id).first()
    if not account:
        return {"success": False, "message": "Account not found"}

    try:
        existing_order = db.query(Order).filter(
            Order.account_id == account_id,
            Order.order_id == order_id
        ).first()

        order_payload = {
            "orderid": str(order_id),
            "stringOrderId": str(existing_order.order_view_id or order_id) if existing_order else str(order_id),
            "title": existing_order.title if existing_order else "",
            "orderAmount": float(existing_order.order_amount or 0) if existing_order and existing_order.order_amount is not None else None,
            "orderStatus": existing_order.order_status if existing_order else None,
            "showstatus": existing_order.showstatus if existing_order else "",
            "catename": existing_order.catename if existing_order else "",
            "ordertime": int(existing_order.order_pay_time.timestamp()) if existing_order and existing_order.order_pay_time else None,
            "cityName": existing_order.city_name if existing_order else "",
        }

        query_status, query_payload = await task_service.query_coupon_data(account, order_payload)
        if query_status == "wind_control":
            return {"success": False, "message": "鏌ヨ瑙﹀彂椋庢帶锛岃绋嶅悗鍐嶈瘯"}

        result, detail = task_service.save_coupon_query_result(db, account, query_status, query_payload)
        if result != "success":
            error_message = (query_payload or {}).get("result", {}).get("error", "鏌ヨ澶辫触")
            return {"success": False, "message": error_message}

        coupons = (query_payload or {}).get("normalized_coupons", [])
        invalidate_order_list_count_cache()
        invalidate_dashboard_stats_cache()

        return {
            "success": True,
            "coupons": coupons,
            "message": f"Query succeeded, fetched {len(coupons)} coupons",
            "saved": True
        }
    except Exception as e:
        return {"success": False, "message": f"鏌ヨ寮傚父: {str(e)}"}

