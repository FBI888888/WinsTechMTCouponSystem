-- =====================================================
-- 券码历史记录表迁移脚本
-- 版本: v1.1.0
-- 日期: 2026-04-01
-- 说明: 支持券码变码检测与历史追溯功能
-- =====================================================

-- 步骤1: 创建券码历史记录表（核心功能，必须执行）
CREATE TABLE IF NOT EXISTS `coupon_history` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `coupon_id` INT NOT NULL COMMENT '当前券码ID',
    `order_id` INT NOT NULL COMMENT '关联订单ID',
    `account_id` INT NOT NULL COMMENT '所属账号ID',
    `old_coupon_code` VARCHAR(100) NOT NULL COMMENT '旧券码',
    `new_coupon_code` VARCHAR(100) NOT NULL COMMENT '新券码',
    `changed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '变更时间',
    `change_reason` VARCHAR(50) DEFAULT 'auto_detect' COMMENT '变更原因',
    PRIMARY KEY (`id`),
    INDEX `idx_old_coupon_code` (`old_coupon_code`),
    INDEX `idx_new_coupon_code` (`new_coupon_code`),
    INDEX `idx_coupon_id` (`coupon_id`),
    INDEX `idx_order_id` (`order_id`),
    FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='券码变更历史表';

-- 步骤2: 验证表创建成功
SELECT 'coupon_history表创建成功' AS result FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'coupon_history' LIMIT 1;

-- 步骤3: 记录版本信息
INSERT INTO `system_config` (`config_key`, `config_value`, `config_type`, `category`, `is_public`, `description`)
VALUES ('system_version', '1.1.0', 'string', 'system', 1, '系统版本号')
ON DUPLICATE KEY UPDATE `config_value` = '1.1.0', `updated_at` = NOW();
