-- Requests reserve refund capacity; approval and channel execution remain separate operations.
CREATE TABLE order_refunds (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  payment_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payment_mode ENUM('DIRECT') NOT NULL,
  platform_mchid VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  transaction_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_fen BIGINT UNSIGNED NOT NULL,
  total_fen BIGINT UNSIGNED NOT NULL,
  platform_fee_fen BIGINT UNSIGNED NOT NULL,
  fee_rule_version VARCHAR(64) NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason VARCHAR(80) NOT NULL,
  status ENUM('REQUESTED','APPROVED','REJECTED','SUBMITTING','PROCESSING','SUCCESS','CLOSED','ABNORMAL') NOT NULL DEFAULT 'REQUESTED',
  settlement_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  review_decision ENUM('APPROVE','REJECT') NULL,
  reviewed_by VARCHAR(64) NULL,
  evidence_reference VARCHAR(255) NULL,
  reviewed_at BIGINT UNSIGNED NULL,
  submission_started_at BIGINT UNSIGNED NULL,
  submission_lease_token CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  submission_lease_until BIGINT UNSIGNED NULL,
  channel_refund_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  succeeded_at BIGINT UNSIGNED NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY refund_request_unique (payment_id, request_key),
  KEY refund_payment_status (payment_id, status),
  KEY refund_order_created (order_id, created_at, id),
  UNIQUE KEY refund_channel_unique (channel_refund_id),
  CONSTRAINT refund_order_fk FOREIGN KEY (order_id) REFERENCES order_aggregates(id),
  CONSTRAINT refund_payment_fk FOREIGN KEY (payment_id) REFERENCES order_payments(id),
  CONSTRAINT refund_amount_check CHECK (amount_fen > 0 AND amount_fen <= total_fen
    AND total_fen <= 9007199254740991 AND platform_fee_fen <= total_fen AND currency='CNY'),
  CONSTRAINT refund_reason_check CHECK (OCTET_LENGTH(reason) BETWEEN 1 AND 80),
  CONSTRAINT refund_success_check CHECK ((status='SUCCESS' AND succeeded_at IS NOT NULL AND succeeded_at>0)
    OR (status<>'SUCCESS' AND succeeded_at IS NULL)),
  CONSTRAINT refund_submission_check CHECK (
    (submission_started_at IS NULL AND submission_lease_token IS NULL AND submission_lease_until IS NULL AND channel_refund_id IS NULL)
    OR (submission_started_at IS NOT NULL AND submission_started_at >= created_at
      AND ((submission_lease_token IS NULL AND submission_lease_until IS NULL)
        OR (submission_lease_token IS NOT NULL AND submission_lease_until IS NOT NULL AND submission_lease_until > submission_started_at)))),
  CONSTRAINT refund_review_check CHECK (
    (review_decision IS NULL AND reviewed_by IS NULL AND evidence_reference IS NULL AND reviewed_at IS NULL AND status='REQUESTED') OR
    (review_decision IS NOT NULL AND reviewed_by IS NOT NULL AND CHAR_LENGTH(reviewed_by)>0
      AND evidence_reference IS NOT NULL AND CHAR_LENGTH(evidence_reference)>0 AND reviewed_at IS NOT NULL
      AND reviewed_at >= created_at AND ((review_decision='REJECT' AND status='REJECTED')
        OR (review_decision='APPROVE' AND status IN ('APPROVED','SUBMITTING','PROCESSING','SUCCESS','CLOSED','ABNORMAL'))))),
  CONSTRAINT refund_time_check CHECK (created_at > 0 AND updated_at >= created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_refund_reversals (
  refund_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  payment_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  refund_fen BIGINT UNSIGNED NOT NULL,
  cumulative_refund_fen BIGINT UNSIGNED NOT NULL,
  platform_reversal_fen BIGINT UNSIGNED NOT NULL,
  provider_reversal_fen BIGINT UNSIGNED NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  KEY refund_reversal_payment (payment_id),
  CONSTRAINT refund_reversal_refund_fk FOREIGN KEY (refund_id) REFERENCES order_refunds(id),
  CONSTRAINT refund_reversal_payment_fk FOREIGN KEY (payment_id) REFERENCES order_payments(id),
  CONSTRAINT refund_reversal_amount_check CHECK (refund_fen>0 AND cumulative_refund_fen>=refund_fen
    AND cumulative_refund_fen<=9007199254740991 AND platform_reversal_fen+provider_reversal_fen=refund_fen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
