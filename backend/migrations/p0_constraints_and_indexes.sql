-- P0 schema hardening for large-scale order and coupon workloads.
-- Apply during a low-traffic window after the duplicate checks below pass.

-- ------------------------------------------------------------------
-- 1. Pre-check duplicate keys before adding unique constraints
-- ------------------------------------------------------------------

SELECT account_id, order_id, COUNT(*) AS duplicate_count
FROM orders
GROUP BY account_id, order_id
HAVING COUNT(*) > 1;

SELECT order_id, coupon_code, COUNT(*) AS duplicate_count
FROM coupons
WHERE coupon_code IS NOT NULL
GROUP BY order_id, coupon_code
HAVING COUNT(*) > 1;

-- ------------------------------------------------------------------
-- 2. Add unique constraints
-- ------------------------------------------------------------------

ALTER TABLE orders
ADD CONSTRAINT uq_orders_account_order_id UNIQUE (account_id, order_id);

ALTER TABLE coupons
ADD CONSTRAINT uq_coupons_order_coupon_code UNIQUE (order_id, coupon_code);

-- ------------------------------------------------------------------
-- 3. Add indexes aligned with current hot paths
-- ------------------------------------------------------------------

ALTER TABLE orders
ADD INDEX idx_orders_account_paytime_id (account_id, order_pay_time, id);

ALTER TABLE orders
ADD INDEX idx_orders_account_coupon_query_paytime_id (
    account_id,
    coupon_query_status,
    order_pay_time,
    id
);

ALTER TABLE coupons
ADD INDEX idx_coupons_account_query_time (account_id, query_time);

ALTER TABLE coupon_history
ADD INDEX idx_coupon_history_coupon_changed_id (coupon_id, changed_at, id);

ALTER TABLE coupon_history
ADD INDEX idx_coupon_history_old_changed_id (old_coupon_code, changed_at, id);

-- ------------------------------------------------------------------
-- 4. Post-check
-- ------------------------------------------------------------------

SHOW INDEX FROM orders;
SHOW INDEX FROM coupons;
SHOW INDEX FROM coupon_history;
