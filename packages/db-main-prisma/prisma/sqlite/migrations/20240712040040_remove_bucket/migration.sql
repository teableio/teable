/*
  Warnings:

  - You are about to drop the column `bucket` on the `attachments` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimetype" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "deleted_time" DATETIME,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT
);
INSERT INTO "new_attachments" ("created_by", "created_time", "deleted_time", "hash", "height", "id", "last_modified_by", "mimetype", "path", "size", "token", "width") SELECT "created_by", "created_time", "deleted_time", "hash", "height", "id", "last_modified_by", "mimetype", "path", "size", "token", "width" FROM "attachments";
DROP TABLE "attachments";
ALTER TABLE "new_attachments" RENAME TO "attachments";
CREATE UNIQUE INDEX "attachments_token_key" ON "attachments"("token");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
