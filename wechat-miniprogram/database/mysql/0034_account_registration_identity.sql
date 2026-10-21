-- Backfill nickname_key with the server NFKC normalization before enabling new registration.
ALTER TABLE accounts
  ADD COLUMN username VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN nickname_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN registration_phone_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN registration_version INT NOT NULL DEFAULT 0,
  ADD UNIQUE KEY accounts_username_unique (username),
  ADD UNIQUE KEY accounts_nickname_key_unique (nickname_key),
  ADD UNIQUE KEY accounts_registration_phone_unique (registration_phone_fingerprint),
  ADD CONSTRAINT accounts_username_format_check CHECK (username IS NULL OR
    (username REGEXP '^[a-z][a-z0-9_]{4,18}[a-z0-9]$' AND username NOT LIKE '%\\_\\_%')),
  ADD CONSTRAINT accounts_registration_v3_check CHECK (registration_version = 0 OR
    (registration_version = 3 AND username IS NOT NULL AND nickname_key IS NOT NULL
      AND registration_phone_fingerprint IS NOT NULL AND uid REGEXP '^[1-9][0-9]{11}$')),
  DROP CHECK accounts_status_check,
  ADD CONSTRAINT accounts_status_check CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED'));

UPDATE accounts a JOIN account_phone_identities p ON p.account_id = a.id
SET a.registration_phone_fingerprint = p.phone_fingerprint;
