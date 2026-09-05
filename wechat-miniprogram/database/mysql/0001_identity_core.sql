CREATE TABLE IF NOT EXISTS `accounts` (
  `id` VARCHAR(64) NOT NULL,
  `uid` VARCHAR(64) NOT NULL,
  `nickname` VARCHAR(80) NOT NULL,
  `avatar_asset_id` VARCHAR(64) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  `version` INT NOT NULL DEFAULT 1,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `accounts_uid_unique` (`uid`),
  CONSTRAINT `accounts_status_check` CHECK (`status` IN ('ACTIVE', 'SUSPENDED', 'CLOSED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wechat_identities` (
  `account_id` VARCHAR(64) NOT NULL,
  `open_id` VARCHAR(128) NOT NULL,
  `union_id` VARCHAR(128) NULL,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`account_id`),
  UNIQUE KEY `wechat_identities_open_id_unique` (`open_id`),
  UNIQUE KEY `wechat_identities_union_id_unique` (`union_id`),
  CONSTRAINT `wechat_identities_account_fk`
    FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `account_roles` (
  `account_id` VARCHAR(64) NOT NULL,
  `role` VARCHAR(16) NOT NULL,
  `enabled_at` BIGINT NOT NULL,
  PRIMARY KEY (`account_id`, `role`),
  CONSTRAINT `account_roles_account_fk`
    FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `account_roles_role_check` CHECK (`role` IN ('BUYER', 'PROVIDER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
