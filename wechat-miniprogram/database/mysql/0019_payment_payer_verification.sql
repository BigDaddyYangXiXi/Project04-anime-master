ALTER TABLE `order_payments`
  ADD COLUMN `payer_verification` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL;

-- Before this migration, a receipt could only be saved after the returned payer matched the reserved payer.
UPDATE `order_payments` SET `payer_verification` = 'MATCHED'
  WHERE `status` IN ('PAID', 'PAID_REQUIRES_REVIEW');

ALTER TABLE `order_payments`
  ADD CONSTRAINT `order_payment_payer_verification_check` CHECK (
    (`status` IN ('CREATED', 'CLOSED') AND `payer_verification` IS NULL)
    OR (`status` = 'PAID' AND `payer_verification` IS NOT NULL AND `payer_verification` = 'MATCHED')
    OR (`status` = 'PAID_REQUIRES_REVIEW' AND `payer_verification` IS NOT NULL AND `payer_verification` IN ('MATCHED', 'MISSING'))
  );
