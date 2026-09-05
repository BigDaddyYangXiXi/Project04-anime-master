ALTER TABLE `media_assets`
  DROP CHECK `media_assets_purpose_check`;

ALTER TABLE `media_assets`
  ADD COLUMN `scope_id` VARCHAR(64) NULL AFTER `purpose`,
  ADD KEY `media_assets_purpose_scope_status_idx` (`purpose`, `scope_id`, `status`),
  ADD CONSTRAINT `media_assets_purpose_check`
    CHECK (`purpose` IN ('AVATAR','NOTICE_IMAGE','WORK_IMAGE','PROJECT_REFERENCE','PROJECT_TARGET','ORDER_DELIVERY'));
