/*
  Warnings:

  - You are about to drop the column `is_oauth` on the `access_token` table. All the data in the column will be lost.
  - You are about to drop the column `is_extension` on the `oauth_app` table. All the data in the column will be lost.
  - You are about to drop the column `app_id` on the `oauth_app_secret` table. All the data in the column will be lost.
  - Added the required column `client_id` to the `oauth_app_secret` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "access_token" DROP COLUMN "is_oauth",
ADD COLUMN     "client_id" TEXT;

-- AlterTable
ALTER TABLE "oauth_app" DROP COLUMN "is_extension";

-- Rename col
ALTER TABLE "oauth_app_secret"
RENAME COLUMN "app_id" TO "client_id";
