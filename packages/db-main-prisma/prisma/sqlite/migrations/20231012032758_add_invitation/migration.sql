-- CreateTable
CREATE TABLE "collaborator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role_name" TEXT NOT NULL,
    "base_id" TEXT,
    "space_id" TEXT,
    "user_id" TEXT NOT NULL,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_by" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "base_id" TEXT,
    "space_id" TEXT,
    "type" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "invitation_code" TEXT NOT NULL,
    "expired_time" DATETIME,
    "create_by" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_time" DATETIME
);

-- CreateTable
CREATE TABLE "invitation_record" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "base_id" TEXT,
    "space_id" TEXT,
    "type" TEXT NOT NULL,
    "inviter" TEXT NOT NULL,
    "accepter" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
