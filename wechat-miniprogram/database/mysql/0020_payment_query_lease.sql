ALTER TABLE `order_payments`
  ADD COLUMN `query_started_at` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN `query_lease_until` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN `query_lease_token` CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD CONSTRAINT `order_payment_query_lease_check` CHECK (
    (`query_lease_token` IS NULL AND `query_lease_until` = 0)
    OR (`query_lease_token` IS NOT NULL AND `query_started_at` > 0 AND `query_lease_until` > `query_started_at`)
  );
