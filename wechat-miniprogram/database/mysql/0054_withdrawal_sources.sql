-- Local draft only. No production migration, grants or payout authorization.
-- Payment failure does not release these request-level income reservations.
CREATE TABLE withdrawal_sources (
  withdrawal_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payment_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_fen BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (withdrawal_id,payment_id),
  KEY withdrawal_source_payment (payment_id,withdrawal_id),
  CONSTRAINT withdrawal_source_request_fk FOREIGN KEY (withdrawal_id) REFERENCES withdrawal_requests(id),
  CONSTRAINT withdrawal_source_net_fk FOREIGN KEY (payment_id) REFERENCES finance_net_settlements(payment_id),
  CONSTRAINT withdrawal_source_positive CHECK (amount_fen>0 AND amount_fen<=9007199254740991)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
