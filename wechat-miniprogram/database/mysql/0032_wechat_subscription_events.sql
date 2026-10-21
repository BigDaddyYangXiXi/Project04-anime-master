-- Authenticated WeChat observations, never a locally inferred send-credit balance.
CREATE TABLE IF NOT EXISTS wechat_subscription_events (
  event_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  recipient_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  template_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(8) NOT NULL,
  status VARCHAR(8) NOT NULL,
  occurred_at BIGINT UNSIGNED NOT NULL,
  INDEX subscription_recipient_time (recipient_key, template_id, occurred_at),
  CONSTRAINT subscription_event_type_check CHECK (event_type IN ('POPUP','CHANGE')),
  CONSTRAINT subscription_event_status_check CHECK (status IN ('ACCEPT','REJECT')),
  CONSTRAINT subscription_change_reject_check CHECK (event_type <> 'CHANGE' OR status = 'REJECT'),
  CONSTRAINT subscription_event_time_check CHECK (occurred_at > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
