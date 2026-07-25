from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.account import MTAccount
from app.models.coupon import Coupon
from app.models.gift_claim import GiftClaim
from app.models.order import Order
from app.schemas.gift_claim import GiftClaimSaveRequest


PENDING_QUERY_STATUS = 0
SUCCESS_QUERY_STATUS = 1


def _normalize(value: Optional[str]) -> str:
    return str(value or "").strip()


def _normalize_encrypt_hash(value: Optional[str]) -> str:
    hash_value = _normalize(value).lower()
    if hash_value and len(hash_value) == 64 and all(ch in "0123456789abcdef" for ch in hash_value):
        return hash_value
    return ""


def find_gift_claim(
    db: Session,
    gift_id: str = "",
    gift_id_encrypt_hash: str = "",
    order_id: str = "",
) -> Optional[GiftClaim]:
    """按 hash / gift_id 精确查找；order_id 不参与新格式幂等。"""
    gift_id = _normalize(gift_id)
    encrypt_hash = _normalize_encrypt_hash(gift_id_encrypt_hash)
    # order_id retained in signature for API compatibility; intentionally unused.
    _ = _normalize(order_id)

    by_hash = None
    by_gift = None
    if encrypt_hash:
        by_hash = (
            db.query(GiftClaim)
            .filter(GiftClaim.gift_id_encrypt_hash == encrypt_hash)
            .first()
        )
    if gift_id:
        by_gift = (
            db.query(GiftClaim)
            .filter(GiftClaim.gift_id == gift_id)
            .first()
        )

    if by_hash and by_gift and by_hash.id != by_gift.id:
        raise HTTPException(
            status_code=409,
            detail="gift_id 与 gift_id_encrypt_hash 命中了不同领取记录",
        )
    return by_hash or by_gift


def serialize_gift_claim(
    claim: Optional[GiftClaim],
    *,
    is_new_claim: bool = False,
    requested_account_id: Optional[int] = None,
) -> dict:
    if not claim:
        return {
            "found": False,
            "coupon_ready": False,
            "is_new_claim": False,
            "account_locked": False,
            "coupon_query_status": PENDING_QUERY_STATUS,
        }

    coupon_code = _normalize(claim.coupon_code) or None
    return {
        "id": claim.id,
        "found": True,
        "coupon_ready": bool(coupon_code and claim.coupon_query_status == SUCCESS_QUERY_STATUS),
        "is_new_claim": is_new_claim,
        "account_locked": bool(
            requested_account_id is not None and requested_account_id != claim.account_id
        ),
        "account_id": claim.account_id,
        "gift_id": claim.gift_id,
        "gift_id_encrypt_hash": claim.gift_id_encrypt_hash,
        "order_id": claim.source_order_id,
        "coupon_code": coupon_code,
        "coupon_query_status": claim.coupon_query_status,
        "gift_type": claim.gift_type,
        "data_source": claim.data_source,
        "order_db_id": claim.order_db_id,
        "coupon_id": claim.coupon_id,
        "claimed_at": claim.claimed_at,
        "coupon_queried_at": claim.coupon_queried_at,
    }


def _upsert_order_projection(
    db: Session,
    claim: GiftClaim,
    request: GiftClaimSaveRequest,
    now: datetime,
) -> Optional[Order]:
    # encrypt-only 且尚无明文 gift_id 时，不创建 orders 投影，避免共享 orderId 碰撞。
    if not claim.gift_id:
        return None

    order_key = _normalize(request.order_id) or claim.gift_id
    order = (
        db.query(Order)
        .filter(Order.account_id == claim.account_id, Order.order_id == order_key)
        .first()
    )
    if not order:
        order = (
            db.query(Order)
            .filter(
                Order.account_id == claim.account_id,
                Order.order_view_id == claim.gift_id,
            )
            .first()
        )

    if not order:
        order = Order(
            account_id=claim.account_id,
            order_id=order_key,
            order_view_id=claim.gift_id,
            title=request.title or f"礼物领取 {claim.gift_id}",
            order_status_bucket="completed",
            is_gift=True,
            order_pay_time=now,
            coupon_query_status=claim.coupon_query_status,
            data_source=claim.data_source,
        )
        db.add(order)
        db.flush()
    else:
        order.order_view_id = order.order_view_id or claim.gift_id
        order.title = request.title or order.title or f"礼物领取 {claim.gift_id}"
        order.order_status_bucket = order.order_status_bucket or "completed"
        order.is_gift = True
        order.coupon_query_status = claim.coupon_query_status
        order.data_source = claim.data_source
        order.updated_at = now

    claim.order_db_id = order.id
    return order


def _upsert_coupon_projection(
    db: Session,
    claim: GiftClaim,
    order: Optional[Order],
    request: GiftClaimSaveRequest,
    now: datetime,
) -> Optional[Coupon]:
    coupon_code = _normalize(request.coupon_code)
    if not coupon_code or not order:
        return None

    coupon = (
        db.query(Coupon)
        .filter(Coupon.order_id == order.id, Coupon.coupon_code == coupon_code)
        .first()
    )
    raw_data = dict(request.raw_data or {})
    raw_data.setdefault("gift_type", claim.gift_type)

    if not coupon:
        coupon = Coupon(
            order_id=order.id,
            account_id=claim.account_id,
            coupon_code=coupon_code,
            encode=request.encode,
            coupon_status=request.coupon_status,
            use_status=request.use_status,
            gift_id=claim.gift_id,
            raw_data=raw_data,
            data_source=claim.data_source,
            query_time=now,
        )
        db.add(coupon)
        db.flush()
    else:
        coupon.encode = request.encode or coupon.encode
        coupon.coupon_status = request.coupon_status or coupon.coupon_status
        if request.use_status is not None:
            coupon.use_status = request.use_status
        coupon.gift_id = claim.gift_id
        coupon.raw_data = raw_data
        coupon.data_source = claim.data_source
        coupon.query_time = now
        coupon.updated_at = now

    claim.coupon_id = coupon.id
    return coupon


def _increment_account_claim_count(db: Session, account_id: int, gift_type: str, now: datetime) -> None:
    if gift_type == "live":
        db.query(MTAccount).filter(MTAccount.id == account_id).update(
            {
                MTAccount.live_claim_count: MTAccount.live_claim_count + 1,
                MTAccount.last_claim_at_live: now,
            },
            synchronize_session=False,
        )
        return

    db.query(MTAccount).filter(MTAccount.id == account_id).update(
        {
            MTAccount.meituan_claim_count: MTAccount.meituan_claim_count + 1,
            MTAccount.last_claim_at_meituan: now,
            MTAccount.last_claim_at: now,
        },
        synchronize_session=False,
    )


def save_gift_claim(
    db: Session,
    request: GiftClaimSaveRequest,
) -> dict:
    gift_id = _normalize(request.gift_id) or None
    encrypt_hash = _normalize_encrypt_hash(request.gift_id_encrypt_hash) or None
    source_order_id = _normalize(request.order_id) or None
    coupon_code = _normalize(request.coupon_code) or None
    gift_type = _normalize(request.gift_type).lower() or "meituan"
    data_source = _normalize(request.data_source) or "wxbot_gift_submit"

    if not gift_id and not encrypt_hash:
        raise HTTPException(status_code=400, detail="gift_id 或 gift_id_encrypt_hash 至少一项")
    if gift_type not in ("meituan", "live"):
        raise HTTPException(status_code=400, detail="gift_type 必须是 meituan 或 live")

    account = db.query(MTAccount).filter(MTAccount.id == request.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    claim = find_gift_claim(
        db,
        gift_id=gift_id or "",
        gift_id_encrypt_hash=encrypt_hash or "",
        order_id="",
    )
    if claim and claim.account_id != request.account_id:
        return serialize_gift_claim(
            claim,
            requested_account_id=request.account_id,
        )

    now = datetime.now()
    is_new_claim = claim is None
    if claim is None:
        claim = GiftClaim(
            gift_id=gift_id,
            gift_id_encrypt_hash=encrypt_hash,
            source_order_id=source_order_id,
            account_id=request.account_id,
            coupon_code=coupon_code,
            coupon_query_status=SUCCESS_QUERY_STATUS if coupon_code else PENDING_QUERY_STATUS,
            gift_type=gift_type,
            data_source=data_source,
            title=request.title,
            raw_data=request.raw_data,
            claimed_at=now,
            coupon_queried_at=now if coupon_code else None,
        )
        db.add(claim)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            existing = find_gift_claim(
                db,
                gift_id=gift_id or "",
                gift_id_encrypt_hash=encrypt_hash or "",
                order_id="",
            )
            if existing:
                return serialize_gift_claim(
                    existing,
                    requested_account_id=request.account_id,
                )
            raise
        _increment_account_claim_count(db, account.id, gift_type, now)
    else:
        if gift_id and not claim.gift_id:
            claim.gift_id = gift_id
        if encrypt_hash and not claim.gift_id_encrypt_hash:
            claim.gift_id_encrypt_hash = encrypt_hash
        claim.source_order_id = claim.source_order_id or source_order_id
        claim.title = request.title or claim.title
        claim.raw_data = request.raw_data or claim.raw_data
        claim.updated_at = now
        if coupon_code:
            claim.coupon_code = coupon_code
            claim.coupon_query_status = SUCCESS_QUERY_STATUS
            claim.coupon_queried_at = now

    order = _upsert_order_projection(db, claim, request, now)
    coupon = _upsert_coupon_projection(db, claim, order, request, now)
    if coupon:
        claim.coupon_code = coupon.coupon_code
        claim.coupon_query_status = SUCCESS_QUERY_STATUS
        claim.coupon_queried_at = now
        if order:
            order.coupon_query_status = SUCCESS_QUERY_STATUS
    elif order:
        order.coupon_query_status = claim.coupon_query_status

    db.commit()
    db.refresh(claim)
    return serialize_gift_claim(
        claim,
        is_new_claim=is_new_claim,
        requested_account_id=request.account_id,
    )
