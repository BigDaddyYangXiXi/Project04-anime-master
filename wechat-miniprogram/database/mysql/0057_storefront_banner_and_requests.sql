ALTER TABLE media_assets DROP CHECK media_assets_purpose_check,
  ADD CONSTRAINT media_assets_purpose_check
  CHECK (purpose IN ('AVATAR','NOTICE_IMAGE','PROVIDER_BANNER','WORK_IMAGE','PROJECT_REFERENCE','PROJECT_TARGET','ORDER_DELIVERY','SUPPORT_IMAGE'));
ALTER TABLE content_intents ADD COLUMN request_key CHAR(64) NULL,
  ADD UNIQUE KEY uq_content_intent_request (account_id,kind,request_key);
