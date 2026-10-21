-- Business subledger only; these entries do not assert bank balance or withdrawal eligibility.
CREATE TABLE fund_journals (
  id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  event_type ENUM('PAYMENT_CONFIRMED','REFUND_SUCCEEDED') NOT NULL,
  payment_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  refund_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reverses_journal_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  provider_id VARCHAR(64) NOT NULL,
  currency CHAR(3) CHARACTER SET ascii NOT NULL,
  fee_rule_version VARCHAR(64) NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY journal_refund (refund_id),
  CONSTRAINT journal_payment_fk FOREIGN KEY(payment_id) REFERENCES order_payments(id),
  CONSTRAINT journal_refund_fk FOREIGN KEY(refund_id) REFERENCES order_refunds(id),
  CONSTRAINT journal_reversal_fk FOREIGN KEY(reverses_journal_id) REFERENCES fund_journals(id),
  CONSTRAINT journal_currency_check CHECK(currency='CNY'),
  CONSTRAINT journal_event_check CHECK (
    (event_type='PAYMENT_CONFIRMED' AND refund_id IS NULL AND reverses_journal_id IS NULL)
    OR (event_type='REFUND_SUCCEEDED' AND refund_id IS NOT NULL AND reverses_journal_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE fund_postings (
  journal_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account ENUM('CHANNEL_RECEIVABLE','PLATFORM_PENDING','PROVIDER_PENDING') NOT NULL,
  direction ENUM('DEBIT','CREDIT') NOT NULL,
  amount_fen BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(journal_id,account),
  CONSTRAINT posting_journal_fk FOREIGN KEY(journal_id) REFERENCES fund_journals(id),
  CONSTRAINT posting_amount_check CHECK(amount_fen>0 AND amount_fen<=9007199254740991)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
