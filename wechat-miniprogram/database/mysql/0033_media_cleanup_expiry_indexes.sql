ALTER TABLE `media_assets`
  ADD KEY `media_assets_pending_expiry_idx` (`status`, `committed_at`, `created_at`),
  ADD KEY `media_assets_delete_retry_idx` (`status`, `deleted_at`);
