/*
  Warnings:

  - Added the required column `invitation_id` to the `invitation_record` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_invitation_record" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invitation_id" TEXT NOT NULL,
    "base_id" TEXT,
    "space_id" TEXT,
    "type" TEXT NOT NULL,
    "inviter" TEXT NOT NULL,
    "accepter" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_invitation_record" ("accepter", "base_id", "created_time", "id", "inviter", "space_id", "type") SELECT "accepter", "base_id", "created_time", "id", "inviter", "space_id", "type" FROM "invitation_record";
DROP TABLE "invitation_record";
ALTER TABLE "new_invitation_record" RENAME TO "invitation_record";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
