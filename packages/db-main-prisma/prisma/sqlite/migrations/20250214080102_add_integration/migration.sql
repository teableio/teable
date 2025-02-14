-- CreateTable
CREATE TABLE "integration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resource_id" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enable" BOOLEAN,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_resource_id_key" ON "integration"("resource_id");
