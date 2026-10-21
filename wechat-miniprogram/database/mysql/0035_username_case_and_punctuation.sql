-- Keep entered case; unique lookup/index use case-insensitive ASCII comparison.
ALTER TABLE accounts
  DROP CHECK accounts_username_format_check,
  MODIFY COLUMN username VARCHAR(12) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  ADD CONSTRAINT accounts_username_format_check CHECK
    (username IS NULL OR (CHAR_LENGTH(username) BETWEEN 2 AND 12 AND username REGEXP '^[!-~]+$'));
