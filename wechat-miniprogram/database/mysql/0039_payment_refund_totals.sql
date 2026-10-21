-- Rebuildable read projection; immutable refund reversals remain the source records.
ALTER TABLE order_payments
  ADD COLUMN refunded_fen BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN platform_refunded_fen BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN provider_refunded_fen BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD CONSTRAINT payment_refund_totals_check CHECK (
    refunded_fen<=amount_fen AND platform_refunded_fen<=platform_fee_fen
    AND platform_refunded_fen+provider_refunded_fen=refunded_fen
    AND provider_refunded_fen<=amount_fen-platform_fee_fen);
