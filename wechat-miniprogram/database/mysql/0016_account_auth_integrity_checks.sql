ALTER TABLE `account_registration_consents`
  ADD CONSTRAINT `account_registration_consents_version_check`
    CHECK (CHAR_LENGTH(TRIM(`notice_version`)) BETWEEN 1 AND 32),
  ADD CONSTRAINT `account_registration_consents_time_check`
    CHECK (`accepted_at` > 0);

ALTER TABLE `account_phone_identities`
  ADD CONSTRAINT `account_phone_identities_fingerprint_check`
    CHECK (`phone_fingerprint` REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT `account_phone_identities_masked_check`
    CHECK (`phone_masked` REGEXP '(^[0-9]{2}[*]{3}[0-9]{2}$)|(^[0-9]{3}[*]{4}[0-9]{4}$)'),
  ADD CONSTRAINT `account_phone_identities_country_check`
    CHECK (`country_code` REGEXP '^[0-9]{1,4}$'),
  ADD CONSTRAINT `account_phone_identities_time_check`
    CHECK (`verified_at` > 0 AND `created_at` > 0 AND `updated_at` >= `created_at`);
