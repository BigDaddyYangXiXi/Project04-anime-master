-- Local proposal only. Back up and inspect the current schema before deployment.
-- Deploy this table before support-api or the reference-aware cleanup update.
CREATE TABLE support_requests (
  id VARCHAR(64) PRIMARY KEY,
  account_id VARCHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  version BIGINT NOT NULL,
  input_hash CHAR(64) NOT NULL,
  payload JSON NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX support_owner_created (account_id, created_at, id),
  INDEX support_queue (status, created_at, id),
  CHECK (kind IN ('FEEDBACK','PHONE','PRIVACY','CANCEL')),
  CHECK (status IN ('PENDING','PROCESSING','REPLIED','CLOSED','WITHDRAWN'))
);
ALTER TABLE media_assets DROP CHECK media_assets_purpose_check,
  ADD CONSTRAINT media_assets_purpose_check
  CHECK (purpose IN ('AVATAR','NOTICE_IMAGE','WORK_IMAGE','PROJECT_REFERENCE','PROJECT_TARGET','ORDER_DELIVERY','SUPPORT_IMAGE'));
