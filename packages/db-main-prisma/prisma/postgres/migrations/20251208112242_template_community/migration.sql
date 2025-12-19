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

-- CreateIndex
CREATE UNIQUE INDEX "template_base_id_key" ON "template"("base_id");

UPDATE "template" SET featured = true WHERE is_published = true;

COMMIT;

