CREATE INDEX `idx_payment_reconcile_due`
  ON `order_payments` (`appid`, `platform_mchid`, `status`, `query_started_at`, `created_at`, `id`);
