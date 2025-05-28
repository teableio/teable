/*
  Warnings:

  - You are about to drop the `snapshots` table. If the table is not empty, all the data it contains will be lost.
  - The required column `id` was added to the `comment_subscription` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `id` was added to the `ops` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `id` was added to the `plugin_context_menu` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- DropIndex
DROP INDEX "snapshots_collection_doc_id_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "snapshots";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_comment_subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_comment_subscription" ("created_by", "created_time", "record_id", "table_id") SELECT "created_by", "created_time", "record_id", "table_id" FROM "comment_subscription";
DROP TABLE "comment_subscription";
ALTER TABLE "new_comment_subscription" RENAME TO "comment_subscription";
CREATE INDEX "comment_subscription_table_id_record_id_idx" ON "comment_subscription"("table_id", "record_id");
CREATE UNIQUE INDEX "comment_subscription_table_id_record_id_key" ON "comment_subscription"("table_id", "record_id");
CREATE TABLE "new_ops" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    "collection" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL
);
INSERT INTO "new_ops" ("collection", "created_by", "created_time", "doc_id", "doc_type", "operation", "version") SELECT "collection", "created_by", "created_time", "doc_id", "doc_type", "operation", "version" FROM "ops";
DROP TABLE "ops";
ALTER TABLE "new_ops" RENAME TO "ops";
CREATE INDEX "ops_collection_created_time_idx" ON "ops"("collection", "created_time");
CREATE UNIQUE INDEX "ops_collection_doc_id_version_key" ON "ops"("collection", "doc_id", "version");
CREATE TABLE "new_plugin_context_menu" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "table_id" TEXT NOT NULL,
    "plugin_install_id" TEXT NOT NULL,
    "order" REAL NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_time" DATETIME,
    "last_modified_by" TEXT,
    CONSTRAINT "plugin_context_menu_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "table_meta" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_plugin_context_menu" ("created_by", "created_time", "last_modified_by", "last_modified_time", "order", "plugin_install_id", "table_id") SELECT "created_by", "created_time", "last_modified_by", "last_modified_time", "order", "plugin_install_id", "table_id" FROM "plugin_context_menu";
DROP TABLE "plugin_context_menu";
ALTER TABLE "new_plugin_context_menu" RENAME TO "plugin_context_menu";
CREATE UNIQUE INDEX "plugin_context_menu_plugin_install_id_key" ON "plugin_context_menu"("plugin_install_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
