-- Reservation drafts only; these tables cannot assert bank submission or payment success.
CREATE TABLE bank_settlement_batches (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  appid VARCHAR(64) NOT NULL,
  platform_mchid VARCHAR(32) NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  status ENUM('RESERVED_DRAFT','CANCELLED') NOT NULL DEFAULT 'RESERVED_DRAFT',
  cancelled_by VARCHAR(64) NULL,
  cancelled_at BIGINT UNSIGNED NULL,
  cancellation_reason VARCHAR(255) NULL,
  CONSTRAINT bank_batch_cancel_check CHECK (
    (status='RESERVED_DRAFT' AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR (status='CANCELLED' AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND cancelled_at>=created_at AND cancellation_reason IS NOT NULL)),
  UNIQUE KEY bank_batch_request (appid,platform_mchid,request_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE bank_settlement_sources (
  batch_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payment_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  provider_id VARCHAR(64) NOT NULL,
  provider_pretax_fen BIGINT UNSIGNED NOT NULL,
  snapshot JSON NOT NULL,
  released_at BIGINT UNSIGNED NULL,
  reserved_payment_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (IF(released_at IS NULL,payment_id,NULL)) STORED,
  reserved_order_id VARCHAR(64) GENERATED ALWAYS AS (IF(released_at IS NULL,order_id,NULL)) STORED,
  PRIMARY KEY(batch_id,payment_id),
  UNIQUE KEY bank_source_payment(reserved_payment_id),
  UNIQUE KEY bank_source_order(reserved_order_id),
  CONSTRAINT bank_source_batch_fk FOREIGN KEY(batch_id) REFERENCES bank_settlement_batches(id),
  CONSTRAINT bank_source_payment_fk FOREIGN KEY(payment_id) REFERENCES order_payments(id),
  CONSTRAINT bank_source_order_fk FOREIGN KEY(order_id) REFERENCES order_aggregates(id),
  CONSTRAINT bank_source_amount_check CHECK(provider_pretax_fen>0 AND provider_pretax_fen<=9007199254740991)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
