-- AlterTable
ALTER TABLE "user_last_visit" ADD COLUMN     "visit_count" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "user_last_visit_resource_type_resource_id_idx" ON "user_last_visit"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "user_last_visit_resource_type_last_visit_time_idx" ON "user_last_visit"("resource_type", "last_visit_time");
