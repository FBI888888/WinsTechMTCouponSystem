-- Native instance account integration.
-- Run this migration with the target database selected by the caller.

ALTER TABLE `mt_accounts`
    ADD COLUMN `union_id` VARCHAR(100) NULL AFTER `open_id_cipher`,
    ADD COLUMN `union_id_cipher` TEXT NULL AFTER `union_id`,
    ADD COLUMN `credential_source` VARCHAR(16) NOT NULL DEFAULT 'legacy' AFTER `union_id_cipher`,
    ADD COLUMN `native_instance_id` VARCHAR(64) NULL AFTER `credential_source`,
    ADD COLUMN `native_instance_code` VARCHAR(24) NULL AFTER `native_instance_id`,
    ADD COLUMN `native_instance_name` VARCHAR(255) NULL AFTER `native_instance_code`,
    ADD COLUMN `native_agent_name` VARCHAR(120) NULL AFTER `native_instance_name`,
    ADD COLUMN `login_uuid` VARCHAR(100) NULL AFTER `native_agent_name`,
    ADD COLUMN `wechat_fingerprint` TEXT NULL AFTER `login_uuid`,
    ADD COLUMN `credential_refreshed_at` DATETIME NULL AFTER `wechat_fingerprint`,
    ADD COLUMN `credential_refresh_status` VARCHAR(20) NOT NULL DEFAULT 'idle' AFTER `credential_refreshed_at`,
    ADD COLUMN `credential_refresh_error` VARCHAR(500) NULL AFTER `credential_refresh_status`,
    ADD UNIQUE KEY `uq_mt_accounts_native_instance_code` (`native_instance_code`),
    ADD KEY `idx_mt_accounts_credential_source` (`credential_source`),
    ADD KEY `idx_mt_accounts_native_instance_id` (`native_instance_id`),
    ADD KEY `idx_mt_accounts_credential_refreshed_at` (`credential_refreshed_at`),
    ADD KEY `idx_mt_accounts_refresh_status` (`credential_refresh_status`);

UPDATE `mt_accounts`
SET `credential_source` = 'legacy', `credential_refresh_status` = 'idle'
WHERE `credential_source` IS NULL OR `credential_source` = '';

CREATE TABLE `native_credential_refresh_jobs` (
    `id` VARCHAR(64) NOT NULL,
    `requested_by` INT NOT NULL,
    `account_id` INT NULL,
    `result_account_id` INT NULL,
    `remark` VARCHAR(100) NULL,
    `instance_id` VARCHAR(64) NOT NULL,
    `instance_code` VARCHAR(24) NOT NULL,
    `instance_name` VARCHAR(255) NULL,
    `agent_name` VARCHAR(120) NULL,
    `state` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `step` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `phone_task_id` VARCHAR(64) NULL,
    `code_task_id` VARCHAR(64) NULL,
    `active_instance_code` VARCHAR(24) NULL,
    `active_account_id` INT NULL,
    `worker_id` VARCHAR(64) NULL,
    `lease_expires_at` DATETIME NULL,
    `error_code` VARCHAR(64) NULL,
    `error_message` VARCHAR(500) NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `started_at` DATETIME NULL,
    `finished_at` DATETIME NULL,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_native_job_active_instance` (`active_instance_code`),
    UNIQUE KEY `uq_native_job_active_account` (`active_account_id`),
    KEY `idx_native_job_requested_by` (`requested_by`),
    KEY `idx_native_job_account` (`account_id`),
    KEY `idx_native_job_instance_code` (`instance_code`),
    KEY `idx_native_job_state` (`state`),
    KEY `idx_native_job_lease` (`lease_expires_at`),
    KEY `idx_native_job_created` (`created_at`),
    CONSTRAINT `fk_native_job_requested_by` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`),
    CONSTRAINT `fk_native_job_account` FOREIGN KEY (`account_id`) REFERENCES `mt_accounts` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_native_job_result_account` FOREIGN KEY (`result_account_id`) REFERENCES `mt_accounts` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
