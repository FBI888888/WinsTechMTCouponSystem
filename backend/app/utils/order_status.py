PENDING_STATUS_BUCKET = "pending"
COMPLETED_STATUS_BUCKET = "completed"
REFUND_STATUS_BUCKET = "refund"
OTHER_STATUS_BUCKET = "other"


def normalize_order_status_bucket(order_status=None, showstatus: str | None = None) -> str:
    normalized_showstatus = str(showstatus or "").strip()

    if "退款" in normalized_showstatus:
        return REFUND_STATUS_BUCKET

    if "已完成" in normalized_showstatus or "待评价" in normalized_showstatus:
        return COMPLETED_STATUS_BUCKET

    if (
        "待消费" in normalized_showstatus
        or "待使用" in normalized_showstatus
        or order_status == 1
    ):
        return PENDING_STATUS_BUCKET

    return OTHER_STATUS_BUCKET
