/*
  Warnings:

  - You are about to drop the column `user_id` on the `collaborator` table. All the data in the column will be lost.
  - Added the required column `principal_id` to the `collaborator` table without a default value. This is not possible if the table is not empty.
  - Added the required column `principal_type` to the `collaborator` table without a default value. This is not possible if the table is not empty.

*/
BEGIN;

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_collaborator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role_name" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "principal_type" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME,
    "last_modified_by" TEXT,
    CONSTRAINT "collaborator_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_collaborator" ("created_by", "created_time", "id", "last_modified_by", "last_modified_time", "resource_id", "resource_type", "role_name", "principal_id", "principal_type") SELECT "created_by", "created_time", "id", "last_modified_by", "last_modified_time", "resource_id", "resource_type", "role_name", "user_id", 'user' FROM "collaborator";
DROP TABLE "collaborator";
ALTER TABLE "new_collaborator" RENAME TO "collaborator";
CREATE UNIQUE INDEX "collaborator_resource_type_resource_id_principal_id_principal_type_key" ON "collaborator"("resource_type", "resource_id", "principal_id", "principal_type");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

COMMIT;