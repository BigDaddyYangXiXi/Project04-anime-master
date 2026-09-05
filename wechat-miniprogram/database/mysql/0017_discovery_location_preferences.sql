CREATE TABLE IF NOT EXISTS `account_discovery_preferences` (
  `account_id` VARCHAR(64) NOT NULL,
  `province_name` VARCHAR(80) NOT NULL DEFAULT '',
  `city_name` VARCHAR(80) NOT NULL,
  `district_name` VARCHAR(80) NOT NULL DEFAULT '',
  `city_code` CHAR(6) NOT NULL,
  `source` VARCHAR(16) NOT NULL,
  `located_at` BIGINT NULL,
  `version` INT NOT NULL DEFAULT 1,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`account_id`),
  KEY `account_discovery_city_idx` (`city_code`, `updated_at`),
  CONSTRAINT `account_discovery_account_fk`
    FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `account_discovery_city_code_check`
    CHECK (`city_code` REGEXP '^[0-9]{6}$'),
  CONSTRAINT `account_discovery_source_check`
    CHECK (`source` IN ('LOCATED', 'MANUAL', 'PROJECT')),
  CONSTRAINT `account_discovery_version_check` CHECK (`version` >= 1),
  CONSTRAINT `account_discovery_time_check`
    CHECK (`created_at` > 0 AND `updated_at` >= `created_at` AND (`located_at` IS NULL OR `located_at` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
