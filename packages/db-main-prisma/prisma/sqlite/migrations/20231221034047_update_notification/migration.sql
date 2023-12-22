/*
  Warnings:

  - You are about to drop the column `icon_meta` on the `notification` table. All the data in the column will be lost.
  - Added the required column `from_user_id` to the `notification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `to_user_id` to the `notification` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from_user" TEXT,
    "to_user" TEXT,
    "from_user_id" TEXT NOT NULL,
    "to_user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "url_meta" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL
);
INSERT INTO "new_notification" ("created_by", "created_time", "from_user", "id", "is_read", "message", "to_user", "type", "url_meta") SELECT "created_by", "created_time", "from_user", "id", "is_read", "message", "to_user", "type", "url_meta" FROM "notification";
DROP TABLE "notification";
ALTER TABLE "new_notification" RENAME TO "notification";
CREATE INDEX "notification_to_user_id_is_read_created_time_idx" ON "notification"("to_user_id", "is_read", "created_time");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
