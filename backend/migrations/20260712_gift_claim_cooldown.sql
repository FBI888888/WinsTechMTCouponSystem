-- 礼物交单联动：账号冷却字段 + 订单/券码来源字段
-- 执行库: mt_coupon
-- 日期: 2026-07-12
-- 说明: 若列已存在会报 Duplicate column，可忽略对应语句继续执行

USE `mt_coupon`;

ALTER TABLE `mt_accounts`
    ADD COLUMN `cooldown_until` DATETIME DEFAULT NULL COMMENT '礼物领取冷却截止时间' AFTER `last_scan_time`;

ALTER TABLE `mt_accounts`
    ADD COLUMN `last_claim_at` DATETIME DEFAULT NULL COMMENT '最近领取成功时间' AFTER `cooldown_until`;

ALTER TABLE `mt_accounts`
    ADD COLUMN `last_limit_at` DATETIME DEFAULT NULL COMMENT '最近收礼上限(1011)时间' AFTER `last_claim_at`;

ALTER TABLE `mt_accounts`
    ADD INDEX `idx_cooldown_until` (`cooldown_until`);

ALTER TABLE `orders`
    ADD COLUMN `data_source` VARCHAR(32) DEFAULT NULL COMMENT '数据来源: wxbot_gift_submit/scanner/electron' AFTER `gift_return_updated_at`;

ALTER TABLE `orders`
    ADD INDEX `idx_orders_data_source` (`data_source`);

ALTER TABLE `coupons`
    ADD COLUMN `data_source` VARCHAR(32) DEFAULT NULL COMMENT '数据来源: wxbot_gift_submit/scanner/electron' AFTER `raw_data`;

ALTER TABLE `coupons`
    ADD INDEX `idx_coupons_data_source` (`data_source`);
