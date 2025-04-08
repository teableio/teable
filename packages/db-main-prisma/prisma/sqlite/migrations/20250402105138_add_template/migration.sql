-- AlterTable
ALTER TABLE "space" ADD COLUMN "is_template" BOOLEAN;

-- CreateTable
CREATE TABLE "template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "base_id" TEXT,
    "cover" TEXT,
    "name" TEXT,
    "description" TEXT,
    "category_id" TEXT,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_time" DATETIME,
    "last_modified_by" TEXT,
    "is_system" BOOLEAN,
    "is_published" BOOLEAN,
    "snapshot" TEXT,
    "order" REAL NOT NULL,
    "usage_count" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "template_category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_time" DATETIME,
    "last_modified_by" TEXT,
    "order" REAL NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "template_category_name_key" ON "template_category"("name");
