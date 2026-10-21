-- Local migration draft. Production migration and grants require separate approval.
CREATE TABLE finance_result_imports (
  id CHAR(32) NOT NULL,
  appid VARCHAR(64) NOT NULL,
  platform_mchid VARCHAR(64) NOT NULL,
  result_id VARCHAR(128) NOT NULL,
  batch_id CHAR(32) NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  result_sha256 CHAR(64) NOT NULL,
  result_snapshot JSON NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_finance_result_scope (appid,platform_mchid,result_id),
  KEY ix_finance_result_batch (appid,platform_mchid,batch_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
