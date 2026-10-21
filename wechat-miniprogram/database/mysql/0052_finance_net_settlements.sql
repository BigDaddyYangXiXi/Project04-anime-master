-- Local draft only. Production migration and grants are not authorized.
-- The approval writer must lock live order/payment sources and insert the matching journal atomically.
CREATE TABLE finance_net_settlements (
  payment_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  import_id CHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  journal_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_id VARCHAR(64) NOT NULL,
  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_pretax_fen BIGINT UNSIGNED NOT NULL,
  income_tax_fen BIGINT UNSIGNED NOT NULL,
  vat_fen BIGINT UNSIGNED NOT NULL,
  surcharge_fen BIGINT UNSIGNED NOT NULL,
  provider_net_fen BIGINT UNSIGNED NOT NULL,
  approved_by VARCHAR(64) NOT NULL,
  approved_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (payment_id),
  UNIQUE KEY uq_finance_net_journal (journal_id),
  KEY ix_finance_net_import (import_id),
  CONSTRAINT finance_net_payment_fk FOREIGN KEY (payment_id) REFERENCES order_payments(id),
  CONSTRAINT finance_net_import_fk FOREIGN KEY (import_id) REFERENCES finance_result_imports(id),
  CONSTRAINT finance_net_journal_fk FOREIGN KEY (journal_id) REFERENCES fund_journals(id),
  CONSTRAINT finance_net_amount_check CHECK (
    provider_pretax_fen<=9007199254740991 AND income_tax_fen<=9007199254740991
    AND vat_fen<=9007199254740991 AND surcharge_fen<=9007199254740991
    AND provider_net_fen<=9007199254740991
    AND CAST(provider_pretax_fen AS DECIMAL(21,0))=CAST(income_tax_fen AS DECIMAL(21,0))+vat_fen+surcharge_fen+provider_net_fen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
