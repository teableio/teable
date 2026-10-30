-- AlterTable
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "manifest" JSONB,
ADD COLUMN IF NOT EXISTS "review" JSONB,
ADD COLUMN IF NOT EXISTS "history" JSONB,
ADD COLUMN IF NOT EXISTS "parent_template_id" TEXT,
ADD COLUMN IF NOT EXISTS "slug" TEXT;

-- AlterTable
ALTER TABLE "template_category" ADD COLUMN IF NOT EXISTS "parent_id" TEXT,
ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'industry',
ADD COLUMN IF NOT EXISTS "key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "template_slug_key" ON "template"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "template_category_parent_id_idx" ON "template_category"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "template_category_key_key" ON "template_category"("key");
