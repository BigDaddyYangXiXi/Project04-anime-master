CREATE TABLE IF NOT EXISTS `account_phone_identities` (
  `account_id` VARCHAR(64) NOT NULL,
  `phone_fingerprint` CHAR(64) NOT NULL,
  `phone_masked` VARCHAR(32) NOT NULL,
  `country_code` VARCHAR(8) NOT NULL,
  `verification_method` VARCHAR(16) NOT NULL,
  `verified_at` BIGINT NOT NULL,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`account_id`),
  UNIQUE KEY `account_phone_identities_fingerprint_unique` (`phone_fingerprint`),
  CONSTRAINT `account_phone_identities_account_fk`
    FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `account_phone_identities_method_check`
    CHECK (`verification_method` IN ('REALTIME', 'FAST'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
