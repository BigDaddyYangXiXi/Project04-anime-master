CREATE TABLE IF NOT EXISTS order_notification_receipts (
  notification_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  status VARCHAR(16) NOT NULL DEFAULT 'STARTED',
  started_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  CONSTRAINT notification_receipt_status_check CHECK (status IN ('STARTED','ACKNOWLEDGED','REJECTED','UNKNOWN')),
  CONSTRAINT notification_receipt_time_check CHECK (started_at > 0 AND updated_at >= started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
