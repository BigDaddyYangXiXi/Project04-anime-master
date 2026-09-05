CREATE TABLE IF NOT EXISTS `account_saved_items` (
  `account_id` VARCHAR(64) NOT NULL,
  `target_type` VARCHAR(16) NOT NULL,
  `target_id` VARCHAR(64) NOT NULL,
  `saved` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` BIGINT UNSIGNED NOT NULL,
  `updated_at` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`account_id`, `target_type`, `target_id`),
  KEY `account_saved_items_account_saved_idx` (`account_id`, `saved`, `updated_at`),
  CONSTRAINT `account_saved_items_account_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `account_saved_items_type_check` CHECK (`target_type` IN ('PROVIDER','WORK')),
  CONSTRAINT `account_saved_items_saved_check` CHECK (`saved` IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
