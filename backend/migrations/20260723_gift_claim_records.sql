-- 礼物领取事实表：固定首次领取账号，券码允许后补，计数仅发生一次。
USE `mt_coupon`;

CREATE TABLE IF NOT EXISTS `gift_claims` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `gift_id` VARCHAR(50) NOT NULL COMMENT '礼物单号/明文giftId',
    `source_order_id` VARCHAR(50) DEFAULT NULL COMMENT '礼物卡片来源orderId',
    `account_id` INT NOT NULL COMMENT '首次成功领取账号，后续不可切换',
    `order_db_id` INT DEFAULT NULL COMMENT '投影到orders后的主键',
    `coupon_id` INT DEFAULT NULL COMMENT '投影到coupons后的主键',
    `coupon_code` VARCHAR(100) DEFAULT NULL COMMENT '券码，未查询到时为空',
    `coupon_query_status` INT NOT NULL DEFAULT 0 COMMENT '0=待查询,1=成功,2=失败',
    `gift_type` VARCHAR(20) NOT NULL DEFAULT 'meituan' COMMENT 'meituan/live',
    `data_source` VARCHAR(32) NOT NULL DEFAULT 'wxbot_gift_submit',
    `title` VARCHAR(200) DEFAULT NULL,
    `raw_data` JSON DEFAULT NULL,
    `claimed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `coupon_queried_at` DATETIME DEFAULT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_gift_claims_gift_id` (`gift_id`),
    UNIQUE KEY `uq_gift_claims_source_order_id` (`source_order_id`),
    INDEX `idx_gift_claims_account_id` (`account_id`),
    INDEX `idx_gift_claims_order_db_id` (`order_db_id`),
    INDEX `idx_gift_claims_coupon_id` (`coupon_id`),
    INDEX `idx_gift_claims_coupon_code` (`coupon_code`),
    INDEX `idx_gift_claims_query_status` (`coupon_query_status`),
    INDEX `idx_gift_claims_gift_type` (`gift_type`),
    INDEX `idx_gift_claims_data_source` (`data_source`),
    INDEX `idx_gift_claims_claimed_at` (`claimed_at`),
    INDEX `idx_gift_claims_account_claimed` (`account_id`, `claimed_at`),
    INDEX `idx_gift_claims_source_status` (`data_source`, `coupon_query_status`),
    CONSTRAINT `fk_gift_claims_account` FOREIGN KEY (`account_id`) REFERENCES `mt_accounts` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_gift_claims_order` FOREIGN KEY (`order_db_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_gift_claims_coupon` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='礼物领取事实表';

-- 从历史机器人券码记录回填。INSERT IGNORE 保证迁移可重复执行，也不会重复计数。
INSERT IGNORE INTO `gift_claims` (
    `gift_id`, `source_order_id`, `account_id`, `order_db_id`, `coupon_id`,
    `coupon_code`, `coupon_query_status`, `gift_type`, `data_source`, `title`,
    `raw_data`, `claimed_at`, `coupon_queried_at`, `created_at`, `updated_at`
)
SELECT
    COALESCE(NULLIF(c.`gift_id`, ''), NULLIF(o.`order_view_id`, ''), o.`order_id`) AS `gift_id`,
    o.`order_id` AS `source_order_id`,
    c.`account_id`,
    o.`id`,
    c.`id`,
    NULLIF(c.`coupon_code`, ''),
    CASE WHEN NULLIF(c.`coupon_code`, '') IS NULL THEN 0 ELSE 1 END,
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(c.`raw_data`, '$.gift_type')), 'meituan'),
    'wxbot_gift_submit',
    o.`title`,
    c.`raw_data`,
    COALESCE(c.`created_at`, NOW()),
    CASE WHEN NULLIF(c.`coupon_code`, '') IS NULL THEN NULL ELSE c.`query_time` END,
    COALESCE(c.`created_at`, NOW()),
    COALESCE(c.`updated_at`, NOW())
FROM `coupons` c
INNER JOIN `orders` o ON o.`id` = c.`order_id`
WHERE c.`data_source` = 'wxbot_gift_submit'
  AND COALESCE(NULLIF(c.`gift_id`, ''), NULLIF(o.`order_view_id`, ''), NULLIF(o.`order_id`, '')) IS NOT NULL
ORDER BY c.`id` ASC;