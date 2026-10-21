CREATE TABLE IF NOT EXISTS payment_mutation_receipts (
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  consumed_at BIGINT UNSIGNED NOT NULL,
  CONSTRAINT mutation_receipt_time_check CHECK (consumed_at > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
