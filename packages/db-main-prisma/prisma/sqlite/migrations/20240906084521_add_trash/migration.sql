-- CreateTable
CREATE TABLE "trash" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "deleted_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_by" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "trash_resource_type_resource_id_key" ON "trash"("resource_type", "resource_id");
