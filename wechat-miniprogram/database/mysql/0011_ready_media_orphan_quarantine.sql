ALTER TABLE `media_assets`
  DROP CHECK `media_assets_status_check`;

ALTER TABLE `media_assets`
  ADD COLUMN `orphaned_at` BIGINT NULL AFTER `committed_at`,
  ADD KEY `media_assets_orphan_cleanup_idx` (`status`, `orphaned_at`),
  ADD CONSTRAINT `media_assets_status_check`
    CHECK (`status` IN ('PENDING', 'READY', 'ORPHAN_CANDIDATE', 'REJECTED', 'DELETED'));
