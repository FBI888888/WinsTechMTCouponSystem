-- 账号平台字段：网页版 Token 按平台切换 UA 防风控
-- 执行库: mt_coupon
-- 日期: 2026-07-12
-- 说明: 若列已存在会报 Duplicate column，可忽略对应语句继续执行

USE `mt_coupon`;

ALTER TABLE `mt_accounts`
    ADD COLUMN `platform` VARCHAR(20) NOT NULL DEFAULT 'windows' COMMENT '设备平台: android/windows/ios/harmony' AFTER `open_id_cipher`;
