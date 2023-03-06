/*
  Warnings:

  - You are about to drop the `keyword` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `poem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `poem_keywords` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `post` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `table` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "keyword";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "poem";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "poem_keywords";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "post";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "table";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "table_meta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "db_table_name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "order" REAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "field" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "options" TEXT,
    "type" TEXT NOT NULL,
    "calculated_type" TEXT NOT NULL,
    "cell_value_type" TEXT NOT NULL,
    "db_field_type" TEXT NOT NULL,
    "db_field_name" TEXT NOT NULL,
    "default_value" TEXT,
    "not_null" BOOLEAN,
    "unique" BOOLEAN,
    "is_primary" BOOLEAN,
    "is_computed" BOOLEAN,
    "table_id" TEXT NOT NULL,
    "column_meta" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME NOT NULL,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,
    CONSTRAINT "field_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "table_meta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "view" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "table_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sort" TEXT,
    "filter" TEXT,
    "group" TEXT,
    "options" TEXT,
    "order" REAL NOT NULL,
    "version" INTEGER NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME NOT NULL,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,
    CONSTRAINT "view_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "table_meta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ops" (
    "collection" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "operation" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "snapshots" (
    "collection" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ops_collection_doc_id_version_key" ON "ops"("collection", "doc_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "snapshots_collection_doc_id_key" ON "snapshots"("collection", "doc_id");
