CREATE TABLE IF NOT EXISTS order_funds_interlocks (
  order_id VARCHAR(64) NOT NULL PRIMARY KEY,
  hold_reason VARCHAR(24) NULL,
  held_at BIGINT UNSIGNED NULL,
  settlement_task_id CHAR(32) NULL,
  settlement_started_at BIGINT UNSIGNED NULL,
  CONSTRAINT funds_interlock_order_fk FOREIGN KEY (order_id) REFERENCES order_aggregates(id),
  CONSTRAINT funds_interlock_hold_check CHECK (
    (hold_reason IS NULL AND held_at IS NULL) OR
    (hold_reason IS NOT NULL AND hold_reason IN ('REFUND_REQUEST','DISPUTE') AND held_at IS NOT NULL AND held_at > 0)),
  CONSTRAINT funds_interlock_submission_check CHECK (
    (settlement_task_id IS NULL AND settlement_started_at IS NULL) OR
    (settlement_task_id IS NOT NULL AND settlement_started_at IS NOT NULL AND settlement_started_at > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
