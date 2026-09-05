CREATE TABLE IF NOT EXISTS `media_security_checks` (
  `asset_id` VARCHAR(64) NOT NULL,
  `trace_id` VARCHAR(128) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'SUBMITTING',
  `label` INT NULL,
  `detail_json` JSON NULL,
  `submitted_at` BIGINT NOT NULL,
  `resolved_at` BIGINT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`asset_id`),
  UNIQUE KEY `media_security_checks_trace_unique` (`trace_id`),
  KEY `media_security_checks_status_idx` (`status`, `updated_at`),
  CONSTRAINT `media_security_checks_asset_fk`
    FOREIGN KEY (`asset_id`) REFERENCES `media_assets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `media_security_checks_status_check`
    CHECK (`status` IN ('SUBMITTING', 'PENDING', 'PASS', 'REVIEW', 'RISKY', 'ERROR'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
