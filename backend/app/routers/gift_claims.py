from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.routers.orders import invalidate_order_list_count_cache
from app.routers.stats import invalidate_dashboard_stats_cache
from app.schemas.gift_claim import GiftClaimResponse, GiftClaimSaveRequest
from app.services.gift_claim_service import (
    find_gift_claim,
    save_gift_claim,
    serialize_gift_claim,
)


router = APIRouter(prefix="/api/gift-claims", tags=["gift-claims"])


@router.get("/precheck", response_model=GiftClaimResponse)
def precheck_gift_claim(
    gift_id: str = Query(""),
    order_id: str = Query(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    claim = find_gift_claim(db, gift_id=gift_id, order_id=order_id)
    return serialize_gift_claim(claim)


@router.post("", response_model=GiftClaimResponse)
def persist_gift_claim(
    request: GiftClaimSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = save_gift_claim(db, request)
    invalidate_order_list_count_cache()
    invalidate_dashboard_stats_cache()
    return result