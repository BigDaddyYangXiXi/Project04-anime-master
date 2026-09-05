ALTER TABLE `media_assets`
  ADD COLUMN `purpose` VARCHAR(32) NULL AFTER `owner_account_id`;

UPDATE `media_assets`
SET `purpose` = CASE
  WHEN `storage_key` LIKE '%/avatar/%' THEN 'AVATAR'
  WHEN `storage_key` LIKE '%/notice_image/%' THEN 'NOTICE_IMAGE'
  WHEN `storage_key` LIKE '%/work_image/%' THEN 'WORK_IMAGE'
  WHEN `storage_key` LIKE '%/project_reference/%' THEN 'PROJECT_REFERENCE'
  WHEN `storage_key` LIKE '%/project_target/%' THEN 'PROJECT_TARGET'
  ELSE NULL
END
WHERE `purpose` IS NULL;

ALTER TABLE `media_assets`
  MODIFY COLUMN `purpose` VARCHAR(32) NOT NULL,
  ADD KEY `media_assets_purpose_status_time_idx` (`purpose`, `status`, `committed_at`),
  ADD CONSTRAINT `media_assets_purpose_check`
    CHECK (`purpose` IN ('AVATAR','NOTICE_IMAGE','WORK_IMAGE','PROJECT_REFERENCE','PROJECT_TARGET'));

ALTER TABLE `account_saved_items`
  ADD KEY `account_saved_items_target_saved_idx` (`target_type`, `target_id`, `saved`);
