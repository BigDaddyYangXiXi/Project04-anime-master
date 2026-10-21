-- Preserve the channel selected at reservation. Historical payments remain COMBINE.
ALTER TABLE order_payments
  ADD COLUMN payment_mode ENUM('COMBINE','DIRECT') NOT NULL DEFAULT 'COMBINE',
  MODIFY COLUMN sub_mchid VARCHAR(32) NULL,
  ADD CONSTRAINT chk_payment_channel_binding CHECK (
    (payment_mode = 'DIRECT' AND sub_mchid IS NULL) OR
    (payment_mode = 'COMBINE' AND sub_mchid IS NOT NULL)
  );
