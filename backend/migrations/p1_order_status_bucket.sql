ALTER TABLE orders
ADD COLUMN order_status_bucket VARCHAR(20) NULL AFTER order_status;

UPDATE orders
SET order_status_bucket = CASE
    WHEN showstatus LIKE '%退款%' THEN 'refund'
    WHEN showstatus LIKE '%已完成%' OR showstatus LIKE '%待评价%' THEN 'completed'
    WHEN showstatus LIKE '%待消费%' OR showstatus LIKE '%待使用%' OR order_status = 1 THEN 'pending'
    ELSE 'other'
END
WHERE order_status_bucket IS NULL;

ALTER TABLE orders
MODIFY COLUMN order_status_bucket VARCHAR(20) NOT NULL;

ALTER TABLE orders
ADD INDEX idx_orders_account_status_bucket_paytime_id (
    account_id,
    order_status_bucket,
    order_pay_time,
    id
);
