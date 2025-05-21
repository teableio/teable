-- DropIndex
DROP INDEX "user_last_visit_user_id_resource_type_parent_resource_id_key";

-- CreateIndex
CREATE INDEX "user_last_visit_user_id_resource_type_parent_resource_id_idx" ON "user_last_visit"("user_id", "resource_type", "parent_resource_id");

CREATE UNIQUE INDEX "user_last_visit_user_id_resource_type_resource_id_key" ON "user_last_visit"("user_id", "resource_type", "resource_id");
