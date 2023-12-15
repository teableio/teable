/*
  Warnings:

  - You are about to drop the column `preference_meta` on the `users` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "password" TEXT,
    "salt" TEXT,
    "phone" TEXT,
    "email" TEXT NOT NULL,
    "avatar" TEXT,
    "notify_meta" TEXT,
    "provider" TEXT,
    "provider_id" TEXT,
    "last_sign_time" DATETIME,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_time" DATETIME,
    "updated_at" DATETIME NOT NULL,
    "last_modified_time" DATETIME NOT NULL
);
INSERT INTO "new_users" ("avatar", "created_time", "deleted_time", "email", "id", "last_modified_time", "last_sign_time", "name", "password", "phone", "provider", "provider_id", "salt", "updated_at") SELECT "avatar", "created_time", "deleted_time", "email", "id", "last_modified_time", "last_sign_time", "name", "password", "phone", "provider", "provider_id", "salt", "updated_at" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_provider_provider_id_key" ON "users"("provider", "provider_id");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
