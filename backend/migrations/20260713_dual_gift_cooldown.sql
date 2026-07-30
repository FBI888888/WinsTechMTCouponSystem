-- 美团/直播礼物分类型冷却字段
-- 执行库: mt_coupon
-- 日期: 2026-07-13
-- 说明: 若列/索引已存在会报 Duplicate，可忽略对应语句继续执行

USE `mt_coupon`;

ALTER TABLE `mt_accounts`
    ADD COLUMN `cooldown_until_meituan` DATETIME DEFAULT NULL COMMENT '美团礼物冷却截止' AFTER `last_limit_at`;

ALTER TABLE `mt_accounts`
    ADD COLUMN `cooldown_until_live` DATETIME DEFAULT NULL COMMENT '直播礼物冷却截止' AFTER `cooldown_until_meituan`;

ALTER TABLE `mt_accounts`
    ADD COLUMN `last_claim_at_meituan` DATETIME DEFAULT NULL COMMENT '最近美团礼物领取' AFTER `cooldown_until_live`;

ALTER TABLE `mt_accounts`
    ADD COLUMN `last_claim_at_live` DATETIME DEFAULT NULL COMMENT '最近直播礼物领取' AFTER `last_claim_at_meituan`;

ALTER TABLE `mt_accounts`
    ADD COLUMN `last_limit_at_meituan` DATETIME DEFAULT NULL COMMENT '最近美团达限时间' AFTER `last_claim_at_live`;

ALTER TABLE `mt_accounts`
    ADD COLUMN `last_limit_at_live` DATETIME DEFAULT NULL COMMENT '最近直播达限时间' AFTER `last_limit_at_meituan`;

-- 历史全局冷却按美团礼物处理
UPDATE `mt_accounts` SET
    `cooldown_until_meituan` = `cooldown_until`,
    `last_claim_at_meituan` = `last_claim_at`,
    `last_limit_at_meituan` = `last_limit_at`
WHERE `cooldown_until` IS NOT NULL
   OR `last_claim_at` IS NOT NULL
   OR `last_limit_at` IS NOT NULL;

ALTER TABLE `mt_accounts`
    ADD INDEX `idx_cooldown_until_meituan` (`cooldown_until_meituan`);

ALTER TABLE `mt_accounts`
    ADD INDEX `idx_cooldown_until_live` (`cooldown_until_live`);
