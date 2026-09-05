CREATE TABLE IF NOT EXISTS `provider_payment_merchants` (
  `provider_id` VARCHAR(64) NOT NULL,
  `platform_mchid` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `sub_mchid` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `verified_at` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`provider_id`),
  UNIQUE KEY `payment_merchant_unique` (`platform_mchid`, `sub_mchid`),
  CONSTRAINT `payment_merchant_provider_fk` FOREIGN KEY (`provider_id`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `payment_merchant_status_check` CHECK (`status` IN ('PENDING','READY','SUSPENDED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_payments` (
  `id` CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `order_id` VARCHAR(64) NOT NULL,
  `request_key` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `order_version` INT UNSIGNED NOT NULL,
  `agreement_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `appid` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `platform_mchid` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `sub_mchid` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payer_openid` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `amount_fen` BIGINT UNSIGNED NOT NULL,
  `currency` CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CNY',
  `fee_rule_version` VARCHAR(64) NOT NULL,
  `platform_fee_fen` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'CREATED',
  `active_order_id` VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN `status` = 'CREATED' THEN `order_id` ELSE NULL END) STORED,
  `transaction_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `received_total_fen` BIGINT UNSIGNED NULL,
  `payer_paid_fen` BIGINT UNSIGNED NULL,
  `received_currency` CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `paid_at` BIGINT UNSIGNED NULL,
  `review_reason` VARCHAR(64) NULL,
  `created_at` BIGINT UNSIGNED NOT NULL,
  `updated_at` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_payment_request_unique` (`order_id`, `request_key`),
  UNIQUE KEY `order_payment_active_unique` (`active_order_id`),
  UNIQUE KEY `order_payment_transaction_unique` (`transaction_id`),
  KEY `order_payment_order_idx` (`order_id`, `status`),
  CONSTRAINT `order_payment_order_fk` FOREIGN KEY (`order_id`) REFERENCES `order_aggregates` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `order_payment_state_check` CHECK (`status` IN ('CREATED','CLOSED','PAID','PAID_REQUIRES_REVIEW')),
  CONSTRAINT `order_payment_version_check` CHECK (`order_version` >= 1),
  CONSTRAINT `order_payment_amount_check` CHECK (`amount_fen` > 0 AND `amount_fen` <= 9007199254740991 AND `currency` = 'CNY'),
  CONSTRAINT `order_payment_fee_check` CHECK (`platform_fee_fen` > 0 AND `platform_fee_fen` <= `amount_fen`),
  CONSTRAINT `order_payment_time_check` CHECK (`updated_at` >= `created_at`),
  CONSTRAINT `order_payment_receipt_check` CHECK (
    (`status` IN ('CREATED','CLOSED') AND `transaction_id` IS NULL AND `received_total_fen` IS NULL AND `payer_paid_fen` IS NULL AND `received_currency` IS NULL AND `paid_at` IS NULL AND `review_reason` IS NULL)
    OR (`status` IN ('PAID','PAID_REQUIRES_REVIEW') AND `transaction_id` IS NOT NULL AND `received_total_fen` IS NOT NULL AND `payer_paid_fen` IS NOT NULL AND `received_currency` IS NOT NULL AND `paid_at` IS NOT NULL AND `received_total_fen` > 0 AND `payer_paid_fen` <= `received_total_fen`
      AND ((`status` = 'PAID' AND `review_reason` IS NULL) OR (`status` = 'PAID_REQUIRES_REVIEW' AND `review_reason` IS NOT NULL)))
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
