-- =====================================================
-- 券码历史记录表迁移脚本
-- 用于支持券码变码检测和记录功能
-- =====================================================

USE `mt_coupon`;

-- 创建券码历史记录表
CREATE TABLE IF NOT EXISTS `coupon_history` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `coupon_id` INT NOT NULL COMMENT '当前券码ID',
    `order_id` INT NOT NULL COMMENT '关联订单ID',
    `account_id` INT NOT NULL COMMENT '所属账号ID',
    `old_coupon_code` VARCHAR(100) NOT NULL COMMENT '旧券码',
    `new_coupon_code` VARCHAR(100) NOT NULL COMMENT '新券码',
    `changed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '变更时间',
    `change_reason` VARCHAR(50) DEFAULT 'auto_detect' COMMENT '变更原因：auto_detect/手动替换',
    PRIMARY KEY (`id`),
    INDEX `idx_old_coupon_code` (`old_coupon_code`),
    INDEX `idx_new_coupon_code` (`new_coupon_code`),
    INDEX `idx_coupon_id` (`coupon_id`),
    INDEX `idx_order_id` (`order_id`),
    FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='券码变更历史表';

-- 为coupons表添加变更次数字段（使用存储过程处理已存在的情况）
DELIMITER //
DROP PROCEDURE IF EXISTS add_change_count_column //
CREATE PROCEDURE add_change_count_column()
BEGIN
    DECLARE col_exists INT DEFAULT 0;
    SELECT COUNT(*) INTO col_exists
    FROM information_schema.columns
    WHERE table_schema = 'mt_coupon'
    AND table_name = 'coupons'
    AND column_name = 'change_count';

    IF col_exists = 0 THEN
        ALTER TABLE `coupons` ADD COLUMN `change_count` INT DEFAULT 0 COMMENT '变更次数';
    END IF;
END //
CALL add_change_count_column() //
DROP PROCEDURE IF EXISTS add_change_count_column //
DELIMITER ;

-- 为coupons表添加encode字段索引（使用存储过程处理已存在的情况）
DELIMITER //
DROP PROCEDURE IF EXISTS add_encode_index //
CREATE PROCEDURE add_encode_index()
BEGIN
    DECLARE idx_exists INT DEFAULT 0;
    SELECT COUNT(*) INTO idx_exists
    FROM information_schema.statistics
    WHERE table_schema = 'mt_coupon'
    AND table_name = 'coupons'
    AND index_name = 'idx_encode';

    IF idx_exists = 0 THEN
        ALTER TABLE `coupons` ADD INDEX `idx_encode` (`encode`);
    END IF;
END //
CALL add_encode_index() //
DROP PROCEDURE IF EXISTS add_encode_index //
DELIMITER ;

-- 完成
SELECT '券码历史记录表迁移完成!' AS message;
