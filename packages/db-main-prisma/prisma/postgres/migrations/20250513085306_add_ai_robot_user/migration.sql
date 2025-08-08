BEGIN;

-- InsertUsers
INSERT INTO "users" (
  "id",
  "name",
  "email",
  "is_system",
  "created_time"
) 
SELECT 
  'aiRobot',
  'AI Robot',
  'aiRobot@system.teable.ai',
  true,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = 'aiRobot');

COMMIT;
