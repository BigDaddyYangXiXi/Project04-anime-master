-- Existing unlinked drafts remain unreadied for approval, never auto-approved.
ALTER TABLE provider_tax_profile_versions
  ADD COLUMN submission_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE KEY tax_profile_submission_once (submission_id),
  ADD CONSTRAINT tax_profile_submission_fk FOREIGN KEY (submission_id) REFERENCES provider_tax_submissions(id);
