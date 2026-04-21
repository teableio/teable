-- Clear chatModel from all space-level AI integration configs.
-- Space integrations should no longer override instance-level chat model settings.
UPDATE "integration"
SET "config" = ("config"::jsonb - 'chatModel')::text
WHERE "type" = 'AI'
  AND "config" IS NOT NULL
  AND ("config"::jsonb ? 'chatModel');
