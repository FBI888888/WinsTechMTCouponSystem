-- 美团/直播礼物领取次数
-- 执行库: mt_coupon
-- 说明: 重复执行时若列已存在，可忽略 Duplicate column 错误；回填语句可重复执行。

USE `mt_coupon`;

ALTER TABLE `mt_accounts`
    ADD COLUMN `meituan_claim_count` INT NOT NULL DEFAULT 0 COMMENT '美团礼物领取次数' AFTER `last_limit_at_live`;

ALTER TABLE `mt_accounts`
    ADD COLUMN `live_claim_count` INT NOT NULL DEFAULT 0 COMMENT '直播礼物领取次数' AFTER `meituan_claim_count`;

-- 历史 wxbot 礼物记录回填。没有 gift_type 的旧记录按美团兼容。
UPDATE `mt_accounts` a
LEFT JOIN (
    SELECT
        c.account_id,
        SUM(
            CASE
                WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(c.raw_data, '$.gift_type')), 'meituan') = 'live'
                THEN 0 ELSE 1
            END
        ) AS meituan_count,
        SUM(
            CASE
                WHEN JSON_UNQUOTE(JSON_EXTRACT(c.raw_data, '$.gift_type')) = 'live'
                THEN 1 ELSE 0
            END
        ) AS live_count
    FROM `coupons` c
    WHERE c.data_source = 'wxbot_gift_submit'
    GROUP BY c.account_id
) counts ON counts.account_id = a.id
SET
    a.meituan_claim_count = COALESCE(counts.meituan_count, 0),
    a.live_claim_count = COALESCE(counts.live_count, 0);