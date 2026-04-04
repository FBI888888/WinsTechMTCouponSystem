# P0 Regression Checklist

## Order Sync

- Sync an account with no local orders and confirm `save-batch` logs `new_count > 0`.
- Sync the same account again and confirm there are no duplicate rows and logs show `update_count` and/or `skip_count`.
- Upload a batch that contains duplicate `orderId` values and confirm the backend returns `skip_count > 0`.
- Confirm the frontend no longer requests `/api/orders/ids`.

## Pending Coupon Query

- Call `/api/orders/pending-coupon-query` with no matching rows and confirm it returns `items=[]`, `returned_count=0`, `has_more=false`.
- Call `/api/orders/pending-coupon-query?limit=10` on an account with more than 10 pending orders and confirm only 10 rows are returned and `has_more=true`.
- Confirm ordering is stable by checking that repeated calls return rows in `order_pay_time desc, id desc`.
- Confirm the backend logs `returned_count`, `has_more`, `limit`, and `duration_ms`.

## Coupon Query

- Query a current coupon code and confirm `/api/coupons/query-backend` returns `status=found`.
- Query a historical old coupon code and confirm the response still resolves to the current coupon.
- Query multiple coupon codes from the same order and confirm logs show one grouped order and one external API attempt for that order.
- Query a non-existent coupon code and confirm it returns `status=not_found`.
- Confirm grouped backend query logs include:
  - `input_count`
  - `unique_input_count`
  - `grouped_order_count`
  - `api_call_attempts`
  - `api_call_successes`
  - `result_statuses`
  - `duration_ms`

## Build / Compile

- Run backend compile validation for:
  - `backend/app/routers/orders.py`
  - `backend/app/routers/coupons.py`
  - `backend/app/services/coupon_change_service.py`
  - `backend/app/schemas/order.py`
- Run a frontend production build and confirm it succeeds.
