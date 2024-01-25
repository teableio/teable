-- CreateTable
CREATE TABLE "access_token" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "user_id" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "space_ids" TEXT,
    "base_ids" TEXT,
    "sign" TEXT NOT NULL,
    "expired_time" DATETIME NOT NULL,
    "last_used_time" DATETIME,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
