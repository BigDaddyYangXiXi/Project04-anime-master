-- Back-office only. No permissions granted to payment runtime by this migration.
CREATE TABLE taxpayer_index_keys (
  withholding_entity_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  key_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
) ENGINE=InnoDB;
CREATE TABLE taxpayer_identities (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  withholding_entity_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  UNIQUE KEY taxpayer_identity_unique (withholding_entity_id,identity_digest),
  UNIQUE KEY taxpayer_identity_owner (id,withholding_entity_id),
  FOREIGN KEY (withholding_entity_id) REFERENCES taxpayer_index_keys(withholding_entity_id)
) ENGINE=InnoDB;
CREATE TABLE taxpayer_submission_bindings (
  submission_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  withholding_entity_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  taxpayer_reference CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  verified_by VARCHAR(64) NOT NULL,
  evidence_reference VARCHAR(128) NOT NULL,
  verified_at BIGINT UNSIGNED NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES provider_tax_submissions(id),
  FOREIGN KEY (taxpayer_reference,withholding_entity_id) REFERENCES taxpayer_identities(id,withholding_entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
