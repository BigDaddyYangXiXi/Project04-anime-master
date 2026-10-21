ALTER TABLE `order_payments`
  ADD COLUMN `prepay_id` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN `prepay_started_at` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN `prepay_lease_until` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN `prepay_lease_token` CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL;
