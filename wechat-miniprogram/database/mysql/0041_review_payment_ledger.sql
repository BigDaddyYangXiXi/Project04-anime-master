-- Verified abnormal receipts are unallocated liabilities, never provider income.
ALTER TABLE fund_journals
  MODIFY event_type ENUM('PAYMENT_CONFIRMED','REFUND_SUCCEEDED','PAYMENT_REVIEW_RECEIVED') NOT NULL,
  DROP CHECK journal_event_check,
  DROP CHECK journal_currency_check,
  ADD CONSTRAINT journal_currency_check CHECK (
    (event_type='PAYMENT_REVIEW_RECEIVED' AND currency REGEXP '^[A-Z]{3}$') OR currency='CNY'),
  ADD CONSTRAINT journal_event_check CHECK (
    (event_type IN ('PAYMENT_CONFIRMED','PAYMENT_REVIEW_RECEIVED') AND refund_id IS NULL AND reverses_journal_id IS NULL)
    OR (event_type='REFUND_SUCCEEDED' AND refund_id IS NOT NULL AND reverses_journal_id IS NOT NULL));
ALTER TABLE fund_postings
  MODIFY account ENUM('CHANNEL_RECEIVABLE','PLATFORM_PENDING','PROVIDER_PENDING','REVIEW_SUSPENSE') NOT NULL;
