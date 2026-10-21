ALTER TABLE `order_payments`
  ADD COLUMN `prepay_recovery_started_at` BIGINT UNSIGNED NOT NULL DEFAULT 0;
