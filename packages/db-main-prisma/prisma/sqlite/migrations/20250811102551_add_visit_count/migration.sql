-- RedefineTables
CREATE TABLE "new_user_last_visit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "parent_resource_id" TEXT NOT NULL,
    "last_visit_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visit_count" INTEGER NOT NULL DEFAULT 1
);
INSERT INTO "new_user_last_visit" ("id", "last_visit_time", "parent_resource_id", "resource_id", "resource_type", "user_id") SELECT "id", "last_visit_time", "parent_resource_id", "resource_id", "resource_type", "user_id" FROM "user_last_visit";
DROP TABLE "user_last_visit";
ALTER TABLE "new_user_last_visit" RENAME TO "user_last_visit";
CREATE INDEX "user_last_visit_user_id_resource_type_idx" ON "user_last_visit"("user_id", "resource_type");
CREATE INDEX "user_last_visit_user_id_resource_type_parent_resource_id_idx" ON "user_last_visit"("user_id", "resource_type", "parent_resource_id");
CREATE INDEX "user_last_visit_resource_type_resource_id_idx" ON "user_last_visit"("resource_type", "resource_id");
CREATE INDEX "user_last_visit_resource_type_last_visit_time_idx" ON "user_last_visit"("resource_type", "last_visit_time");
CREATE UNIQUE INDEX "user_last_visit_user_id_resource_type_resource_id_key" ON "user_last_visit"("user_id", "resource_type", "resource_id");
