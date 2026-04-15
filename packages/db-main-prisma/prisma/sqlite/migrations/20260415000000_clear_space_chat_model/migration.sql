-- Clear chatModel from all space-level AI integration configs.
-- Space integrations should no longer override instance-level chat model settings.
UPDATE "integration"
SET "config" = json_remove("config", '$.chatModel')
WHERE "type" = 'AI'
  AND "config" IS NOT NULL
  AND json_extract("config", '$.chatModel') IS NOT NULL;
