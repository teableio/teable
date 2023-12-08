/*
  Warnings:

  - You are about to drop the column `column_meta` on the `field` table. All the data in the column will be lost.
  - Added the required column `column_meta` to the `view` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_view" (
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
    "column_meta" TEXT NOT NULL,
    "enable_share" BOOLEAN,
    "share_id" TEXT,
    "share_meta" TEXT,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME NOT NULL,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,
    CONSTRAINT "view_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "table_meta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_view" ("created_by", "created_time", "deleted_time", "description", "enable_share", "filter", "group", "id", "last_modified_by", "last_modified_time", "name", "options", "order", "share_id", "share_meta", "sort", "table_id", "type", "version") SELECT "created_by", "created_time", "deleted_time", "description", "enable_share", "filter", "group", "id", "last_modified_by", "last_modified_time", "name", "options", "order", "share_id", "share_meta", "sort", "table_id", "type", "version" FROM "view";
DROP TABLE "view";
ALTER TABLE "new_view" RENAME TO "view";
CREATE INDEX "view_order_idx" ON "view"("order");
CREATE TABLE "new_field" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "options" TEXT,
    "type" TEXT NOT NULL,
    "cell_value_type" TEXT NOT NULL,
    "is_multiple_cell_value" BOOLEAN,
    "db_field_type" TEXT NOT NULL,
    "db_field_name" TEXT NOT NULL,
    "not_null" BOOLEAN,
    "unique" BOOLEAN,
    "is_primary" BOOLEAN,
    "is_computed" BOOLEAN,
    "is_lookup" BOOLEAN,
    "has_error" BOOLEAN,
    "lookup_linked_field_id" TEXT,
    "lookup_options" TEXT,
    "table_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME NOT NULL,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,
    CONSTRAINT "field_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "table_meta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_field" ("cell_value_type", "created_by", "created_time", "db_field_name", "db_field_type", "deleted_time", "description", "has_error", "id", "is_computed", "is_lookup", "is_multiple_cell_value", "is_primary", "last_modified_by", "last_modified_time", "lookup_linked_field_id", "lookup_options", "name", "not_null", "options", "table_id", "type", "unique", "version") SELECT "cell_value_type", "created_by", "created_time", "db_field_name", "db_field_type", "deleted_time", "description", "has_error", "id", "is_computed", "is_lookup", "is_multiple_cell_value", "is_primary", "last_modified_by", "last_modified_time", "lookup_linked_field_id", "lookup_options", "name", "not_null", "options", "table_id", "type", "unique", "version" FROM "field";
DROP TABLE "field";
ALTER TABLE "new_field" RENAME TO "field";
CREATE INDEX "field_lookup_linked_field_id_idx" ON "field"("lookup_linked_field_id");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
