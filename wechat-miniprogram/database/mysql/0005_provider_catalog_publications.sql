CREATE TABLE IF NOT EXISTS `provider_catalog_publications` (
  `provider_id` VARCHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `draft_version` INT NOT NULL,
  `publication_version` INT NOT NULL DEFAULT 1,
  `published_at` BIGINT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`provider_id`),
  KEY `provider_catalog_publications_time_idx` (`published_at`),
  CONSTRAINT `provider_catalog_publications_provider_fk`
    FOREIGN KEY (`provider_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `provider_catalog_publications_draft_version_check`
    CHECK (`draft_version` >= 1),
  CONSTRAINT `provider_catalog_publications_version_check`
    CHECK (`publication_version` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
