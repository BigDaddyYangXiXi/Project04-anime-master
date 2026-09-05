CREATE TABLE IF NOT EXISTS `provider_catalog_drafts` (
  `provider_id` VARCHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `version` INT NOT NULL DEFAULT 1,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`provider_id`),
  CONSTRAINT `provider_catalog_drafts_provider_fk`
    FOREIGN KEY (`provider_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `provider_catalog_drafts_version_check` CHECK (`version` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
