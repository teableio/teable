-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_oauth_app_authorized" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "authorized_time" DATETIME NOT NULL,
    CONSTRAINT "oauth_app_authorized_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_app" ("client_id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_oauth_app_authorized" ("authorized_time", "client_id", "id", "user_id") SELECT "authorized_time", "client_id", "id", "user_id" FROM "oauth_app_authorized";
DROP TABLE "oauth_app_authorized";
ALTER TABLE "new_oauth_app_authorized" RENAME TO "oauth_app_authorized";
CREATE UNIQUE INDEX "oauth_app_authorized_client_id_user_id_key" ON "oauth_app_authorized"("client_id", "user_id");
CREATE TABLE "new_oauth_app_secret" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "masked_secret" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_used_time" DATETIME,
    CONSTRAINT "oauth_app_secret_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_app" ("client_id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_oauth_app_secret" ("client_id", "created_by", "created_time", "id", "last_used_time", "masked_secret", "secret") SELECT "client_id", "created_by", "created_time", "id", "last_used_time", "masked_secret", "secret" FROM "oauth_app_secret";
DROP TABLE "oauth_app_secret";
ALTER TABLE "new_oauth_app_secret" RENAME TO "oauth_app_secret";
CREATE UNIQUE INDEX "oauth_app_secret_secret_key" ON "oauth_app_secret"("secret");
CREATE TABLE "new_oauth_app_token" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "app_secret_id" TEXT NOT NULL,
    "refresh_token_sign" TEXT NOT NULL,
    "expired_time" DATETIME NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    CONSTRAINT "oauth_app_token_app_secret_id_fkey" FOREIGN KEY ("app_secret_id") REFERENCES "oauth_app_secret" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_oauth_app_token" ("app_secret_id", "created_by", "created_time", "expired_time", "id", "refresh_token_sign") SELECT "app_secret_id", "created_by", "created_time", "expired_time", "id", "refresh_token_sign" FROM "oauth_app_token";
DROP TABLE "oauth_app_token";
ALTER TABLE "new_oauth_app_token" RENAME TO "oauth_app_token";
CREATE UNIQUE INDEX "oauth_app_token_refresh_token_sign_key" ON "oauth_app_token"("refresh_token_sign");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
