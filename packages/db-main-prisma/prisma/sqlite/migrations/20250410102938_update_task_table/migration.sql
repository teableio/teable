/*
  Warnings:

  - Added the required column `created_by` to the `task` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "snapshot" TEXT,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT
);
INSERT INTO "new_task" ("created_time", "id", "snapshot", "status", "type") SELECT "created_time", "id", "snapshot", "status", "type" FROM "task";
DROP TABLE "task";
ALTER TABLE "new_task" RENAME TO "task";
CREATE INDEX "task_type_status_idx" ON "task"("type", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
