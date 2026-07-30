-- 新格式礼物：以 giftIdEncrypt 的 SHA256 作为稳定幂等键。
-- gift_id 改为可空，允许 encrypt-only 先落库绑定账号；
-- 去掉 source_order_id 唯一约束，支持同父订单多个礼物。
USE `mt_coupon`;

ALTER TABLE `gift_claims`
    ADD COLUMN `gift_id_encrypt_hash` CHAR(64) DEFAULT NULL
        COMMENT 'SHA256(normalized giftIdEncrypt) hex，新格式幂等键'
        AFTER `gift_id`;

ALTER TABLE `gift_claims`
    MODIFY COLUMN `gift_id` VARCHAR(50) DEFAULT NULL
        COMMENT '明文 giftId，解析后回填；encrypt-only 时可为空';

ALTER TABLE `gift_claims`
    DROP INDEX `uq_gift_claims_source_order_id`;

ALTER TABLE `gift_claims`
    ADD INDEX `idx_gift_claims_source_order_id` (`source_order_id`);

CREATE UNIQUE INDEX `uq_gift_claims_encrypt_hash`
    ON `gift_claims` (`gift_id_encrypt_hash`);
