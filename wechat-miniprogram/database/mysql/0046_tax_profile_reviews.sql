-- Privileged review audit, local migration only.
CREATE TABLE provider_tax_profile_reviews (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  profile_version_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  from_status ENUM('PENDING','VERIFIED') NOT NULL,
  to_status ENUM('VERIFIED','REJECTED','REVOKED') NOT NULL,
  reviewed_by VARCHAR(64) NOT NULL,
  evidence_reference VARCHAR(128) NOT NULL,
  reviewed_at BIGINT UNSIGNED NOT NULL,
  CONSTRAINT tax_review_profile FOREIGN KEY (profile_version_id) REFERENCES provider_tax_profile_versions(id),
  CONSTRAINT tax_review_transition CHECK (
    (from_status='PENDING' AND to_status IN ('VERIFIED','REJECTED'))
    OR (from_status='VERIFIED' AND to_status='REVOKED')),
  KEY tax_review_history (profile_version_id, reviewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
