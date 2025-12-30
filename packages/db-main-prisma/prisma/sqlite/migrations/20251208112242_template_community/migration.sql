-- This migration is intentionally empty for SQLite
-- SQLite does not support array types, so we keep the categoryId as a single string field

BEGIN;
ALTER TABLE "template" ADD COLUMN     "featured" BOOLEAN;
ALTER TABLE "template" ADD COLUMN     "publish_info" JSON;

-- Remove duplicate base_id records, keep only the most recently modified one for each base_id
DELETE FROM "template"
WHERE id IN (
  SELECT id FROM (
    SELECT id, 
           ROW_NUMBER() OVER (
             PARTITION BY base_id 
             ORDER BY last_modified_time DESC NULLS LAST, created_time DESC NULLS LAST
           ) as rn
    FROM "template"
    WHERE base_id IS NOT NULL
  ) t
  WHERE rn > 1
);

-- CreateIndex
CREATE UNIQUE INDEX "template_base_id_key" ON "template"("base_id");

UPDATE "template" SET featured = true WHERE is_published = true;

COMMIT;