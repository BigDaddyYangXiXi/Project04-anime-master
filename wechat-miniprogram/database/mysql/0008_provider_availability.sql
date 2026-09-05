CREATE TABLE IF NOT EXISTS `provider_availability` (
  `provider_id` VARCHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` BIGINT UNSIGNED NOT NULL,
  `updated_at` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`provider_id`),
  CONSTRAINT `provider_availability_provider_fk` FOREIGN KEY (`provider_id`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `provider_availability_version_check` CHECK (`version` >= 1),
  CONSTRAINT `provider_availability_time_check` CHECK (`updated_at` >= `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
