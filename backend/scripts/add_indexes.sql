-- =====================================================
-- WinsTechMT Coupon System 数据库索引优化脚本
-- 执行说明：在低峰期执行，避免影响线上业务
-- 执行顺序：按文件顺序执行
-- =====================================================

-- 1. 订单表索引优化
-- ----------------------------

-- 订单状态索引（状态筛选）
ALTER TABLE orders ADD INDEX idx_order_status (order_status);

-- 券码查询状态索引
ALTER TABLE orders ADD INDEX idx_coupon_query_status (coupon_query_status);

-- 账号+状态复合索引（按账号筛选状态）
ALTER TABLE orders ADD INDEX idx_account_status (account_id, order_status);

-- 账号+支付时间复合索引（按账号查询订单列表）
ALTER TABLE orders ADD INDEX idx_account_paytime (account_id, order_pay_time);


-- 2. 券码表索引优化
-- ----------------------------

-- 券码状态索引
ALTER TABLE coupons ADD INDEX idx_coupon_status (coupon_status);

-- 使用状态索引
ALTER TABLE coupons ADD INDEX idx_use_status (use_status);

-- 账号+查询时间复合索引
ALTER TABLE coupons ADD INDEX idx_account_querytime (account_id, query_time);


-- 3. 定时任务日志索引优化
-- ----------------------------

-- 状态+开始时间复合索引（查询运行中任务）
ALTER TABLE scheduled_task_logs ADD INDEX idx_status_started (status, started_at);


-- 4. 验证索引是否创建成功
-- ----------------------------

-- 查看订单表索引
SHOW INDEX FROM orders;

-- 查看券码表索引
SHOW INDEX FROM coupons;

-- 查看定时任务日志表索引
SHOW INDEX FROM scheduled_task_logs;


-- =====================================================
-- 注意事项：
-- 1. 如果索引已存在，会报错 "Duplicate key name"，可忽略
-- 2. 大表添加索引可能需要几分钟，请在低峰期执行
-- 3. 建议使用 pt-online-schema-change 工具在线添加索引
-- =====================================================
