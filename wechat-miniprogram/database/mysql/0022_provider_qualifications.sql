CREATE TABLE IF NOT EXISTS provider_qualifications (
  provider_id VARCHAR(64) NOT NULL PRIMARY KEY,
  career VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  application JSON NOT NULL,
  eligibility_verified TINYINT UNSIGNED NOT NULL DEFAULT 0,
  reviewed_by VARCHAR(128) NULL,
  review_note VARCHAR(500) NOT NULL DEFAULT '',
  evidence_reference VARCHAR(255) NULL,
  submitted_at BIGINT UNSIGNED NOT NULL,
  reviewed_at BIGINT UNSIGNED NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT provider_qualifications_account_fk FOREIGN KEY (provider_id) REFERENCES accounts(id),
  CONSTRAINT provider_qualifications_status_check CHECK (status IN ('PENDING','APPROVED','REJECTED','SUSPENDED')),
  CONSTRAINT provider_qualifications_eligibility_check CHECK (eligibility_verified IN (0,1)),
  CONSTRAINT provider_qualifications_approval_check CHECK (status <> 'APPROVED' OR
    (eligibility_verified = 1 AND reviewed_by IS NOT NULL AND reviewed_by <> '' AND reviewed_at IS NOT NULL AND evidence_reference IS NOT NULL AND evidence_reference <> ''))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS provider_qualification_reviews (
  id CHAR(32) NOT NULL PRIMARY KEY,
  provider_id VARCHAR(64) NOT NULL,
  qualification_version INT UNSIGNED NOT NULL,
  decision VARCHAR(16) NOT NULL,
  reviewed_by VARCHAR(128) NOT NULL,
  review_note VARCHAR(500) NOT NULL,
  evidence_reference VARCHAR(255) NOT NULL,
  reviewed_at BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY qualification_review_version (provider_id, qualification_version),
  CONSTRAINT qualification_reviews_provider_fk FOREIGN KEY (provider_id) REFERENCES provider_qualifications(provider_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
