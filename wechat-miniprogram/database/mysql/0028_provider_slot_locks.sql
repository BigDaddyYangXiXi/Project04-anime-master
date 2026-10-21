CREATE TABLE IF NOT EXISTS `provider_slot_locks` (
  `provider_id` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`provider_id`),
  CONSTRAINT `provider_slot_locks_account_fk`
    FOREIGN KEY (`provider_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
