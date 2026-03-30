-- MT 券码系统数据库初始化脚本
-- 创建日期: 2026-03-29

-- 创建数据库
CREATE DATABASE IF NOT EXISTS `mt_coupon` DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `mt_coupon`;

-- =====================================================
-- 用户表
-- =====================================================
CREATE TABLE IF NOT EXISTS `users` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL COMMENT '用户名',
    `password_hash` VARCHAR(255) NOT NULL COMMENT '密码哈希',
    `role` VARCHAR(20) NOT NULL DEFAULT 'user' COMMENT '角色: admin/user',
    `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否激活',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- =====================================================
-- 美团账号表
-- =====================================================
CREATE TABLE IF NOT EXISTS `mt_accounts` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT DEFAULT NULL COMMENT '所属用户ID',
    `remark` VARCHAR(100) DEFAULT NULL COMMENT '备注名',
    `userid` VARCHAR(50) NOT NULL COMMENT '美团userId',
    `token` TEXT NOT NULL COMMENT '美团token',
    `url` TEXT COMMENT '完整URL',
    `csecuuid` VARCHAR(100) DEFAULT NULL COMMENT '抓包获取',
    `open_id` VARCHAR(100) DEFAULT NULL COMMENT 'openId',
    `open_id_cipher` VARCHAR(255) DEFAULT NULL COMMENT 'openIdCipher',
    `status` ENUM('normal', 'invalid', 'unchecked') NOT NULL DEFAULT 'unchecked' COMMENT '账号状态',
    `last_check_time` DATETIME DEFAULT NULL COMMENT '最后检测时间',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_userid` (`userid`),
    INDEX `idx_userid` (`userid`),
    INDEX `idx_user` (`user_id`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='美团账号表';

-- =====================================================
-- 订单表
-- =====================================================
CREATE TABLE IF NOT EXISTS `orders` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `account_id` INT NOT NULL COMMENT '所属账号ID',
    `order_id` VARCHAR(50) NOT NULL COMMENT '订单号',
    `order_view_id` VARCHAR(50) DEFAULT NULL COMMENT '推广单号',
    `title` VARCHAR(200) DEFAULT NULL COMMENT '标题',
    `order_amount` DECIMAL(10,2) DEFAULT NULL COMMENT '订单金额',
    `commission_fee` DECIMAL(10,2) DEFAULT NULL COMMENT '佣金',
    `total_coupon_num` INT DEFAULT NULL COMMENT '子订单数',
    `order_status` INT DEFAULT NULL COMMENT '订单状态(2付款/3完成/4取消/5风控/6结算)',
    `showstatus` VARCHAR(50) DEFAULT NULL COMMENT '原始状态文本',
    `catename` VARCHAR(50) DEFAULT NULL COMMENT '分类名称',
    `is_gift` TINYINT(1) DEFAULT 0 COMMENT '是否为礼物订单',
    `order_pay_time` DATETIME DEFAULT NULL COMMENT '支付时间',
    `city_name` VARCHAR(50) DEFAULT NULL COMMENT '下单城市',
    `consume_city_name` VARCHAR(50) DEFAULT NULL COMMENT '消费城市',
    `coupon_query_status` INT DEFAULT 0 COMMENT '券码查询状态: 0=待查询, 1=成功, 2=失败',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_account_order` (`account_id`, `order_id`),
    INDEX `idx_order_id` (`order_id`),
    INDEX `idx_pay_time` (`order_pay_time`),
    FOREIGN KEY (`account_id`) REFERENCES `mt_accounts`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单表';

-- =====================================================
-- 券码表
-- =====================================================
CREATE TABLE IF NOT EXISTS `coupons` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `order_id` INT NOT NULL COMMENT '关联订单ID',
    `account_id` INT NOT NULL COMMENT '所属账号ID',
    `coupon_code` VARCHAR(100) DEFAULT NULL COMMENT '券码',
    `coupon_status` INT DEFAULT NULL COMMENT '券码状态',
    `gift_id` VARCHAR(50) DEFAULT NULL COMMENT '礼物号',
    `query_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '查询时间',
    `raw_data` JSON DEFAULT NULL COMMENT '原始数据',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    INDEX `idx_coupon_code` (`coupon_code`),
    INDEX `idx_gift_id` (`gift_id`),
    INDEX `idx_order` (`order_id`),
    INDEX `idx_account` (`account_id`),
    FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`account_id`) REFERENCES `mt_accounts`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='券码表';

-- =====================================================
-- 系统配置表
-- =====================================================
CREATE TABLE IF NOT EXISTS `system_config` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `config_key` VARCHAR(50) NOT NULL COMMENT '配置键',
    `config_value` TEXT DEFAULT NULL COMMENT '配置值',
    `config_type` VARCHAR(20) NOT NULL DEFAULT 'string' COMMENT '类型: string/number/boolean/json',
    `category` VARCHAR(30) DEFAULT NULL COMMENT '分类: scan/proxy/api/log',
    `is_public` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否对普通用户可见',
    `description` VARCHAR(255) DEFAULT NULL COMMENT '描述',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_config_key` (`config_key`),
    INDEX `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';

-- =====================================================
-- 操作日志表
-- =====================================================
CREATE TABLE IF NOT EXISTS `operation_logs` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT DEFAULT NULL COMMENT '用户ID',
    `action` VARCHAR(50) DEFAULT NULL COMMENT '操作类型',
    `target_type` VARCHAR(20) DEFAULT NULL COMMENT '目标类型',
    `target_id` INT DEFAULT NULL COMMENT '目标ID',
    `details` TEXT COMMENT '详情',
    `ip_address` VARCHAR(50) DEFAULT NULL COMMENT 'IP地址',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    INDEX `idx_user` (`user_id`),
    INDEX `idx_created` (`created_at`),
    INDEX `idx_action` (`action`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作日志表';

-- =====================================================
-- 登录日志表
-- =====================================================
CREATE TABLE IF NOT EXISTS `login_logs` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT DEFAULT NULL COMMENT '用户ID',
    `username` VARCHAR(50) DEFAULT NULL COMMENT '用户名',
    `ip_address` VARCHAR(50) DEFAULT NULL COMMENT 'IP地址',
    `user_agent` VARCHAR(255) DEFAULT NULL COMMENT '用户代理',
    `login_status` VARCHAR(20) DEFAULT NULL COMMENT '登录状态: success/failed',
    `fail_reason` VARCHAR(255) DEFAULT NULL COMMENT '失败原因',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    INDEX `idx_user` (`user_id`),
    INDEX `idx_created` (`created_at`),
    INDEX `idx_status` (`login_status`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录日志表';

-- =====================================================
-- 定时任务日志表
-- =====================================================
CREATE TABLE IF NOT EXISTS `scheduled_task_logs` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `task_name` VARCHAR(50) NOT NULL COMMENT '任务名称',
    `status` VARCHAR(20) NOT NULL COMMENT '状态: running/success/failed',
    `accounts_scanned` INT DEFAULT 0 COMMENT '扫描账号数',
    `orders_found` INT DEFAULT 0 COMMENT '发现订单数',
    `coupons_queried` INT DEFAULT 0 COMMENT '查询券码数',
    `error_message` TEXT COMMENT '错误信息',
    `started_at` DATETIME NOT NULL COMMENT '开始时间',
    `finished_at` DATETIME DEFAULT NULL COMMENT '结束时间',
    `duration_seconds` INT DEFAULT NULL COMMENT '耗时(秒)',
    PRIMARY KEY (`id`),
    INDEX `idx_task_name` (`task_name`),
    INDEX `idx_status` (`status`),
    INDEX `idx_started_at` (`started_at`),
    INDEX `idx_task_started` (`task_name`, `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='定时任务日志表';

-- =====================================================
-- API密钥表
-- =====================================================
CREATE TABLE IF NOT EXISTS `api_keys` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(64) NOT NULL COMMENT 'API Key',
    `secret` VARCHAR(128) NOT NULL COMMENT 'API Secret',
    `name` VARCHAR(50) DEFAULT NULL COMMENT '密钥名称/用途',
    `rate_limit` INT NOT NULL DEFAULT 100 COMMENT '每分钟请求限制',
    `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否激活',
    `last_used_at` DATETIME DEFAULT NULL COMMENT '最后使用时间',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `expired_at` DATETIME DEFAULT NULL COMMENT '过期时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_key` (`key`),
    INDEX `idx_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API密钥表';

-- =====================================================
-- 初始化默认管理员账户
-- 密码: admin123 (bcrypt hash)
-- =====================================================
INSERT INTO `users` (`username`, `password_hash`, `role`, `is_active`)
VALUES ('admin', '$2b$12$LRNxYjba7qt7iwwk8pEFh.Kx2cSmbmJVrvn62ElmNKsNQnlQh5lF.', 'admin', 1);

-- =====================================================
-- 初始化默认系统配置
-- =====================================================
INSERT INTO `system_config` (`config_key`, `config_value`, `config_type`, `category`, `is_public`, `description`) VALUES
('scan_interval', '30', 'number', 'scan', 0, '扫描间隔（分钟）'),
('scan_request_interval', '0.7', 'number', 'scan', 0, '请求间隔（秒）'),
('scan_max_retries', '3', 'number', 'scan', 0, '最大重试次数'),
('proxy_port', '8898', 'number', 'proxy', 0, '抓包端口'),
('log_level', 'INFO', 'string', 'log', 0, '日志级别'),
('log_retention_days', '30', 'number', 'log', 0, '日志保留天数'),
('api_rate_limit', '100', 'number', 'api', 0, 'API默认每分钟请求限制');

-- =====================================================
-- 完成
-- =====================================================
SELECT '数据库初始化完成!' AS message;
SELECT '默认管理员账户: admin / admin123' AS account;
