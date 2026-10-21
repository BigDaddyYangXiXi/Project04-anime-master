ALTER TABLE `order_settlement_tasks`
  DROP CHECK `settlement_task_state_check`,
  ADD COLUMN `channel_order_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN `channel_result` JSON NULL,
  ADD COLUMN `verified_at` BIGINT UNSIGNED NULL,
  ADD UNIQUE KEY `settlement_channel_order_unique` (`channel_order_id`),
  ADD CONSTRAINT `settlement_task_state_check` CHECK (`status` IN ('PREPARED','PROCESSING','FEE_SUCCEEDED','CLOSED'));
