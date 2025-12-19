-- This migration is intentionally empty for SQLite
-- SQLite does not support array types, so we keep the categoryId as a single string field

BEGIN;
ALTER TABLE "template" ADD COLUMN     "featured" BOOLEAN;
ALTER TABLE "template" ADD COLUMN     "publish_info" JSON;

-- CreateIndex
CREATE UNIQUE INDEX "template_base_id_key" ON "template"("base_id");

UPDATE "template" SET featured = true WHERE is_published = true;

COMMIT;