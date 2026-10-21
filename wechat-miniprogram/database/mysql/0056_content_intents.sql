ALTER TABLE accounts ADD COLUMN pending_content_intent_id CHAR(32) NULL;
ALTER TABLE provider_catalog_drafts ADD COLUMN pending_content_intent_id CHAR(32) NULL;
CREATE TABLE IF NOT EXISTS content_intents (
  id CHAR(32) NOT NULL PRIMARY KEY,
  account_id VARCHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  expected_version BIGINT NOT NULL,
  payload JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'STAGED',
  result_code VARCHAR(64) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX ix_content_intents_pending (status, updated_at),
  INDEX ix_content_intents_owner (account_id, kind, created_at)
);
