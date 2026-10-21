-- Local-only. Sensitive payload remains encrypted, submission is not verification.
CREATE TABLE provider_tax_submissions (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  withholding_entity_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  appid VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  encrypted_payload JSON NOT NULL,
  notice_version VARCHAR(64) NOT NULL,
  submitted_at BIGINT UNSIGNED NOT NULL,
  KEY tax_submission_owner (withholding_entity_id,appid,provider_id,submitted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
