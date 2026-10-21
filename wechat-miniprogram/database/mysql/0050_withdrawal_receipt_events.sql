-- Local migration only; no production grants or payment execution.
CREATE TABLE withdrawal_receipt_events (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  payment_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform_mchid VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bank_transaction_reference VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  input_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_status VARCHAR(16) NOT NULL,
  resulting_status ENUM('PROCESSING','UNKNOWN','SUCCEEDED','FAILED') NOT NULL,
  operator_id VARCHAR(64) NOT NULL,
  evidence_reference VARCHAR(128) NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES withdrawal_bank_payments(id),
  UNIQUE KEY withdrawal_bank_receipt (platform_mchid,bank_transaction_reference),
  KEY withdrawal_receipt_payment (payment_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
