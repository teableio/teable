-- CreateTable
CREATE TABLE "pin_resource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "pin_resource_created_by_resource_id_key" ON "pin_resource"("created_by", "resource_id");
