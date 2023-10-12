/*
  Warnings:

  - Added the required column `doc_type` to the `ops` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ops" (
    "collection" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL
);
INSERT INTO "new_ops" ("collection", "created_by", "created_time", "doc_id", "operation", "version") SELECT "collection", "created_by", "created_time", "doc_id", "operation", "version" FROM "ops";
DROP TABLE "ops";
ALTER TABLE "new_ops" RENAME TO "ops";
CREATE INDEX "ops_collection_created_time_idx" ON "ops"("collection", "created_time");
CREATE UNIQUE INDEX "ops_collection_doc_id_version_key" ON "ops"("collection", "doc_id", "version");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
