CREATE TABLE IF NOT EXISTS `project_aggregates` (
  `id` VARCHAR(64) NOT NULL,
  `buyer_id` VARCHAR(64) NOT NULL,
  `create_idempotency_key` VARCHAR(128) NOT NULL,
  `payload` JSON NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` BIGINT UNSIGNED NOT NULL,
  `updated_at` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `project_aggregates_buyer_idempotency_unique` (`buyer_id`, `create_idempotency_key`),
  KEY `project_aggregates_buyer_time_idx` (`buyer_id`, `updated_at`),
  CONSTRAINT `project_aggregates_buyer_fk` FOREIGN KEY (`buyer_id`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `project_aggregates_version_check` CHECK (`version` >= 1),
  CONSTRAINT `project_aggregates_time_check` CHECK (`updated_at` >= `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
