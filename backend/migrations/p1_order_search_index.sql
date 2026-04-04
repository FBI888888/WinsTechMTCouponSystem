ALTER TABLE orders
ADD INDEX idx_orders_account_order_view_id (
    account_id,
    order_view_id
);
