/*
  Warnings:

  - You are about to drop the column `app_id` on the `oauth_app_secret` table. All the data in the column will be lost.
  - You are about to drop the column `is_oauth` on the `access_token` table. All the data in the column will be lost.
  - You are about to drop the column `is_extension` on the `oauth_app` table. All the data in the column will be lost.
  - Added the required column `client_id` to the `oauth_app_secret` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_oauth_app_secret" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "masked_secret" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_used_time" DATETIME
);
INSERT INTO "new_oauth_app_secret" ("created_by", "created_time", "id", "last_used_time", "masked_secret", "secret") SELECT "created_by", "created_time", "id", "last_used_time", "masked_secret", "secret" FROM "oauth_app_secret";
DROP TABLE "oauth_app_secret";
ALTER TABLE "new_oauth_app_secret" RENAME TO "oauth_app_secret";
CREATE UNIQUE INDEX "oauth_app_secret_secret_key" ON "oauth_app_secret"("secret");
CREATE TABLE "new_access_token" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "user_id" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "space_ids" TEXT,
    "base_ids" TEXT,
    "sign" TEXT NOT NULL,
    "client_id" TEXT,
    "expired_time" DATETIME NOT NULL,
    "last_used_time" DATETIME,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME
);
INSERT INTO "new_access_token" ("base_ids", "created_time", "description", "expired_time", "id", "last_modified_time", "last_used_time", "name", "scopes", "sign", "space_ids", "user_id") SELECT "base_ids", "created_time", "description", "expired_time", "id", "last_modified_time", "last_used_time", "name", "scopes", "sign", "space_ids", "user_id" FROM "access_token";
DROP TABLE "access_token";
ALTER TABLE "new_access_token" RENAME TO "access_token";
CREATE TABLE "new_oauth_app" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "homepage" TEXT NOT NULL,
    "description" TEXT,
    "client_id" TEXT NOT NULL,
    "redirect_uris" TEXT,
    "scopes" TEXT,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME,
    "created_by" TEXT NOT NULL
);
INSERT INTO "new_oauth_app" ("client_id", "created_by", "created_time", "description", "homepage", "id", "last_modified_time", "logo", "name", "redirect_uris", "scopes") SELECT "client_id", "created_by", "created_time", "description", "homepage", "id", "last_modified_time", "logo", "name", "redirect_uris", "scopes" FROM "oauth_app";
DROP TABLE "oauth_app";
ALTER TABLE "new_oauth_app" RENAME TO "oauth_app";
CREATE UNIQUE INDEX "oauth_app_client_id_key" ON "oauth_app"("client_id");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
