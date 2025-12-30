BEGIN;

-- template_category
ALTER TABLE "template" ADD COLUMN "category_id_new" TEXT[];

UPDATE "template" 
SET "category_id_new" = ARRAY[category_id]
WHERE "category_id" IS NOT NULL AND "category_id" != '';

ALTER TABLE "template" DROP COLUMN "category_id";

ALTER TABLE "template" RENAME COLUMN "category_id_new" TO "category_id";

-- featured
ALTER TABLE "template" ADD COLUMN     "featured" BOOLEAN;

-- AlterTable
ALTER TABLE "template" ADD COLUMN     "publish_info" JSONB;

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

