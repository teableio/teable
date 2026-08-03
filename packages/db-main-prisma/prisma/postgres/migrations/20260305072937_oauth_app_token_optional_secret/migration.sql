BEGIN;
-- AlterTable
ALTER TABLE "oauth_app_token" ALTER COLUMN "app_secret_id" DROP NOT NULL;

-- Add Column client_id
-- 1) add as nullable first
ALTER TABLE "oauth_app_token" ADD COLUMN "client_id" TEXT;

-- 2) backfill from oauth_app_secret
UPDATE "oauth_app_token" t
SET "client_id" = s."client_id"
FROM "oauth_app_secret" s
WHERE t."app_secret_id" = s."id"
  AND t."client_id" IS NULL;

-- 3) enforce not null
ALTER TABLE "oauth_app_token"
ALTER COLUMN "client_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "oauth_app_token" ADD CONSTRAINT "oauth_app_token_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_app"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;