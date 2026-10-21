-- Local draft. Profile review writes require a separate authorized back-office path.
-- References are opaque internal identifiers, never plaintext identity documents.
CREATE TABLE provider_tax_profile_versions (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  withholding_entity_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  appid VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  taxpayer_reference VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_type ENUM('INDIVIDUAL','SOLE_PROPRIETOR','COMPANY') NOT NULL,
  tax_residency ENUM('UNCONFIRMED','RESIDENT','NON_RESIDENT','NOT_APPLICABLE') NOT NULL,
  income_nature ENUM('UNCONFIRMED','PLATFORM_LABOR','BUSINESS','COPYRIGHT','OTHER') NOT NULL,
  review_status ENUM('PENDING','VERIFIED','REJECTED','REVOKED') NOT NULL,
  review_reference VARCHAR(128) NULL,
  reviewed_by VARCHAR(64) NULL,
  reviewed_at BIGINT UNSIGNED NULL,
  valid_from_period CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  valid_through_period CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  CONSTRAINT tax_profile_period CHECK (
    valid_from_period REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$'
    AND valid_through_period REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$'
    AND valid_through_period >= valid_from_period),
  CONSTRAINT tax_profile_review CHECK (review_status <> 'VERIFIED' OR (
    review_reference IS NOT NULL AND CHAR_LENGTH(TRIM(review_reference)) > 0
    AND reviewed_by IS NOT NULL AND CHAR_LENGTH(TRIM(reviewed_by)) > 0
    AND reviewed_at IS NOT NULL AND reviewed_at >= created_at
    AND income_nature <> 'UNCONFIRMED'
    AND ((entity_type = 'INDIVIDUAL' AND tax_residency IN ('RESIDENT','NON_RESIDENT'))
      OR (entity_type IN ('SOLE_PROPRIETOR','COMPANY') AND tax_residency = 'NOT_APPLICABLE')))),
  KEY tax_profile_owner (withholding_entity_id, appid, provider_id),
  KEY tax_profile_taxpayer (withholding_entity_id, taxpayer_reference)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
