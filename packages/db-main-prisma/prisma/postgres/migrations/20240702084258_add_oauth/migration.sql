-- AlterTable
ALTER TABLE "access_token" ADD COLUMN     "is_oauth" BOOLEAN;

-- CreateTable
CREATE TABLE "oauth_app" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "homepage" TEXT NOT NULL,
    "description" TEXT,
    "client_id" TEXT NOT NULL,
    "redirect_uris" TEXT,
    "scopes" TEXT,
    "is_extension" BOOLEAN,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,

    CONSTRAINT "oauth_app_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_app_authorized" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "authorized_time" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_app_authorized_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_app_secret" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "masked_secret" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_used_time" TIMESTAMP(3),

    CONSTRAINT "oauth_app_secret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_app_token" (
    "id" TEXT NOT NULL,
    "app_secret_id" TEXT NOT NULL,
    "refresh_token_sign" TEXT NOT NULL,
    "expired_time" TIMESTAMP(3) NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "oauth_app_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_app_client_id_key" ON "oauth_app"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_app_authorized_client_id_user_id_key" ON "oauth_app_authorized"("client_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_app_secret_secret_key" ON "oauth_app_secret"("secret");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_app_token_refresh_token_sign_key" ON "oauth_app_token"("refresh_token_sign");
