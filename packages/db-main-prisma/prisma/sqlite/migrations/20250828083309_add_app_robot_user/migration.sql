-- InsertUsers
INSERT INTO "users" (
  "id",
  "name",
  "email",
  "is_system",
  "created_time"
) 
SELECT 
  'appRobot',
  'App Robot',
  'appRobot@system.teable.ai',
  1,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = 'appRobot');
