-- Local draft. No production migration or grants authorized by this file.
-- Source reservations, account verification and payment writers remain separate work.
CREATE TABLE withdrawal_requests (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  appid VARCHAR(64) NOT NULL,
  platform_mchid VARCHAR(32) NOT NULL,
  provider_id VARCHAR(64) NOT NULL,
  requested_net_fen BIGINT UNSIGNED NOT NULL,
  approved_net_fen BIGINT UNSIGNED NULL,
  approval_reference VARCHAR(128) NULL,
  approved_by VARCHAR(64) NULL,
  approved_at BIGINT UNSIGNED NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  CONSTRAINT withdrawal_requested_positive CHECK (requested_net_fen > 0),
  CONSTRAINT withdrawal_approval_complete CHECK (
    (approved_net_fen IS NULL AND approval_reference IS NULL AND approved_by IS NULL AND approved_at IS NULL)
    OR (approved_net_fen IS NOT NULL AND approved_net_fen > 0 AND approved_net_fen = requested_net_fen
      AND approval_reference IS NOT NULL AND approved_by IS NOT NULL
      AND approved_at IS NOT NULL AND approved_at >= created_at)),
  KEY withdrawal_provider (appid, platform_mchid, provider_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE withdrawal_bank_payments (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  withdrawal_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_fen BIGINT UNSIGNED NOT NULL,
  status ENUM('RESERVED','EXPORTED','PROCESSING','UNKNOWN','SUCCEEDED','FAILED','CANCELLED') NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  account_version_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  evidence_reference VARCHAR(128) NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  CONSTRAINT withdrawal_payment_positive CHECK (amount_fen > 0),
  CONSTRAINT withdrawal_payment_time CHECK (updated_at >= created_at),
  CONSTRAINT withdrawal_payment_request FOREIGN KEY (withdrawal_id) REFERENCES withdrawal_requests(id),
  KEY withdrawal_payment_lookup (withdrawal_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
