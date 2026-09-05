CREATE TABLE IF NOT EXISTS `account_registration_consents` (
  `account_id` VARCHAR(64) NOT NULL,
  `notice_version` VARCHAR(32) NOT NULL,
  `accepted_at` BIGINT NOT NULL,
  PRIMARY KEY (`account_id`),
  CONSTRAINT `account_registration_consents_account_fk`
    FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
