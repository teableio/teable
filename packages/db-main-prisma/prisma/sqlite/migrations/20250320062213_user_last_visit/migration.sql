-- CreateTable
CREATE TABLE "user_last_visit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "parent_resource_id" TEXT NOT NULL,
    "last_visit_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "user_last_visit_user_id_resource_type_idx" ON "user_last_visit"("user_id", "resource_type");

-- CreateIndex
CREATE UNIQUE INDEX "user_last_visit_user_id_resource_type_parent_resource_id_key" ON "user_last_visit"("user_id", "resource_type", "parent_resource_id");
