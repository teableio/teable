BEGIN;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ref_meta" TEXT;

-- InsertUsers
INSERT INTO "users" (
  "id",
  "name",
  "email",
  "is_system",
  "created_time"
) 
SELECT 
  'automationRobot',
  'Automation Robot',
  'automationRobot@system.teable.io',
  true,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = 'automationRobot');

INSERT INTO "users" (
  "id",
  "name",
  "email",
  "is_system",
  "created_time"
) 
SELECT 
  'anonymous',
  'Anonymous',
  'anonymous@system.teable.io',
  true,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = 'anonymous');

COMMIT;
