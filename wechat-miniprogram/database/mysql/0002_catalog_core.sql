CREATE TABLE IF NOT EXISTS `media_assets` (
  `id` VARCHAR(64) NOT NULL,
  `owner_account_id` VARCHAR(64) NOT NULL,
  `storage_key` VARCHAR(512) NOT NULL,
  `original_filename` VARCHAR(255) NULL,
  `mime_type` VARCHAR(128) NOT NULL,
  `size_bytes` BIGINT NOT NULL,
  `width` INT NULL,
  `height` INT NULL,
  `sha256` CHAR(64) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `created_at` BIGINT NOT NULL,
  `committed_at` BIGINT NULL,
  `deleted_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `media_assets_storage_key_unique` (`storage_key`),
  KEY `media_assets_owner_idx` (`owner_account_id`, `status`),
  CONSTRAINT `media_assets_owner_fk`
    FOREIGN KEY (`owner_account_id`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `media_assets_status_check`
    CHECK (`status` IN ('PENDING', 'READY', 'REJECTED', 'DELETED')),
  CONSTRAINT `media_assets_size_check` CHECK (`size_bytes` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `provider_profiles` (
  `provider_id` VARCHAR(64) NOT NULL,
  `career` VARCHAR(120) NOT NULL,
  `city` VARCHAR(120) NOT NULL DEFAULT '',
  `bio` TEXT NOT NULL,
  `notice` TEXT NOT NULL,
  `notice_image_asset_id` VARCHAR(64) NULL,
  `publish_status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  `published_at` BIGINT NULL,
  `version` INT NOT NULL DEFAULT 1,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`provider_id`),
  KEY `provider_profiles_notice_image_idx` (`notice_image_asset_id`),
  CONSTRAINT `provider_profiles_provider_fk`
    FOREIGN KEY (`provider_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `provider_profiles_notice_image_fk`
    FOREIGN KEY (`notice_image_asset_id`) REFERENCES `media_assets` (`id`) ON DELETE SET NULL,
  CONSTRAINT `provider_profiles_publish_status_check`
    CHECK (`publish_status` IN ('DRAFT', 'PUBLISHED', 'HIDDEN'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `provider_profile_tags` (
  `provider_id` VARCHAR(64) NOT NULL,
  `tag` VARCHAR(80) NOT NULL,
  `sort_order` INT NOT NULL,
  PRIMARY KEY (`provider_id`, `tag`),
  UNIQUE KEY `provider_profile_tags_sort_unique` (`provider_id`, `sort_order`),
  CONSTRAINT `provider_profile_tags_provider_fk`
    FOREIGN KEY (`provider_id`) REFERENCES `provider_profiles` (`provider_id`) ON DELETE CASCADE,
  CONSTRAINT `provider_profile_tags_sort_check` CHECK (`sort_order` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `provider_services` (
  `id` VARCHAR(64) NOT NULL,
  `provider_id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `price_fen` BIGINT NOT NULL,
  `unit` VARCHAR(40) NOT NULL,
  `description` TEXT NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `provider_services_id_provider_unique` (`id`, `provider_id`),
  KEY `provider_services_provider_idx` (`provider_id`, `status`, `sort_order`),
  CONSTRAINT `provider_services_provider_fk`
    FOREIGN KEY (`provider_id`) REFERENCES `provider_profiles` (`provider_id`) ON DELETE CASCADE,
  CONSTRAINT `provider_services_price_check` CHECK (`price_fen` > 0),
  CONSTRAINT `provider_services_status_check`
    CHECK (`status` IN ('ACTIVE', 'HIDDEN', 'DELETED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `works` (
  `id` VARCHAR(64) NOT NULL,
  `provider_id` VARCHAR(64) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `subtitle` VARCHAR(255) NOT NULL DEFAULT '',
  `price_fen` BIGINT NOT NULL,
  `description` TEXT NOT NULL,
  `tone` VARCHAR(32) NOT NULL DEFAULT 'coral',
  `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  `reference_count` INT NOT NULL DEFAULT 0,
  `published_at` BIGINT NULL,
  `version` INT NOT NULL DEFAULT 1,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `works_code_unique` (`code`),
  UNIQUE KEY `works_id_provider_unique` (`id`, `provider_id`),
  KEY `works_provider_idx` (`provider_id`, `status`, `published_at`),
  CONSTRAINT `works_provider_fk`
    FOREIGN KEY (`provider_id`) REFERENCES `provider_profiles` (`provider_id`) ON DELETE CASCADE,
  CONSTRAINT `works_price_check` CHECK (`price_fen` > 0),
  CONSTRAINT `works_reference_count_check` CHECK (`reference_count` >= 0),
  CONSTRAINT `works_status_check`
    CHECK (`status` IN ('DRAFT', 'PUBLISHED', 'HIDDEN', 'DELETED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `work_images` (
  `id` VARCHAR(64) NOT NULL,
  `work_id` VARCHAR(64) NOT NULL,
  `asset_id` VARCHAR(64) NOT NULL,
  `sort_order` INT NOT NULL,
  `created_at` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `work_images_asset_unique` (`work_id`, `asset_id`),
  UNIQUE KEY `work_images_sort_unique` (`work_id`, `sort_order`),
  KEY `work_images_asset_idx` (`asset_id`),
  CONSTRAINT `work_images_work_fk`
    FOREIGN KEY (`work_id`) REFERENCES `works` (`id`) ON DELETE CASCADE,
  CONSTRAINT `work_images_asset_fk`
    FOREIGN KEY (`asset_id`) REFERENCES `media_assets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `work_images_sort_check` CHECK (`sort_order` BETWEEN 0 AND 4)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `work_tags` (
  `work_id` VARCHAR(64) NOT NULL,
  `tag` VARCHAR(80) NOT NULL,
  `sort_order` INT NOT NULL,
  PRIMARY KEY (`work_id`, `tag`),
  UNIQUE KEY `work_tags_sort_unique` (`work_id`, `sort_order`),
  CONSTRAINT `work_tags_work_fk`
    FOREIGN KEY (`work_id`) REFERENCES `works` (`id`) ON DELETE CASCADE,
  CONSTRAINT `work_tags_sort_check` CHECK (`sort_order` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `service_works` (
  `work_id` VARCHAR(64) NOT NULL,
  `service_id` VARCHAR(64) NOT NULL,
  `provider_id` VARCHAR(64) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`work_id`),
  KEY `service_works_service_idx` (`service_id`, `sort_order`),
  CONSTRAINT `service_works_work_provider_fk`
    FOREIGN KEY (`work_id`, `provider_id`)
    REFERENCES `works` (`id`, `provider_id`) ON DELETE CASCADE,
  CONSTRAINT `service_works_service_provider_fk`
    FOREIGN KEY (`service_id`, `provider_id`)
    REFERENCES `provider_services` (`id`, `provider_id`) ON DELETE CASCADE,
  CONSTRAINT `service_works_sort_check` CHECK (`sort_order` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `provider_pinned_works` (
  `provider_id` VARCHAR(64) NOT NULL,
  `work_id` VARCHAR(64) NOT NULL,
  `position` INT NOT NULL,
  `created_at` BIGINT NOT NULL,
  PRIMARY KEY (`provider_id`, `work_id`),
  UNIQUE KEY `provider_pinned_works_position_unique` (`provider_id`, `position`),
  CONSTRAINT `provider_pinned_works_work_provider_fk`
    FOREIGN KEY (`work_id`, `provider_id`)
    REFERENCES `works` (`id`, `provider_id`) ON DELETE CASCADE,
  CONSTRAINT `provider_pinned_works_position_check` CHECK (`position` BETWEEN 1 AND 2)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
