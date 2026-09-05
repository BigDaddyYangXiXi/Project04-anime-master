CREATE TABLE IF NOT EXISTS `media_cleanup_runs` (
  `id` VARCHAR(64) NOT NULL,
  `source` VARCHAR(16) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `pending_summary` JSON NULL,
  `ready_orphan_summary` JSON NULL,
  `error_code` VARCHAR(64) NULL,
  `started_at` BIGINT UNSIGNED NOT NULL,
  `finished_at` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  KEY `media_cleanup_runs_time_idx` (`finished_at`),
  KEY `media_cleanup_runs_status_time_idx` (`status`, `finished_at`),
  CONSTRAINT `media_cleanup_runs_source_check` CHECK (`source` IN ('TIMER','MANUAL','TARGET')),
  CONSTRAINT `media_cleanup_runs_status_check` CHECK (`status` IN ('SUCCESS','PARTIAL','FAILED')),
  CONSTRAINT `media_cleanup_runs_time_check` CHECK (`finished_at` >= `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
