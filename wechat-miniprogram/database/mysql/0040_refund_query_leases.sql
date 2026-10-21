ALTER TABLE order_refunds
  ADD COLUMN query_started_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN query_lease_until BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN query_lease_token CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD KEY refund_query_due (platform_mchid,status,query_started_at,created_at,id),
  ADD CONSTRAINT refund_query_lease_check CHECK (
    (query_lease_token IS NULL AND query_lease_until=0)
    OR (query_lease_token IS NOT NULL AND query_lease_until>query_started_at));
