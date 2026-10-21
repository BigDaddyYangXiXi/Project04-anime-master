-- Local-only migration. No production grants or tax filing authorized here.
-- These immutable calculations are NOT withheld tax, payable balances or filings.
CREATE TABLE tax_assessment_drafts (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  withholding_entity_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  settlement_reference VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  taxpayer_reference VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tax_period CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rule_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  input_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  calculation_input JSON NOT NULL,
  calculation_result JSON NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY tax_assessment_source (withholding_entity_id, settlement_reference),
  KEY tax_assessment_person_period (withholding_entity_id, taxpayer_reference, tax_period),
  CONSTRAINT tax_assessment_period CHECK (tax_period REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT tax_assessment_input_hash CHECK (input_sha256 REGEXP '^[a-f0-9]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
