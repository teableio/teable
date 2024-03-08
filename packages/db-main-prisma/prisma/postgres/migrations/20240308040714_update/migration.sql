/*
  Warnings:

  - You are about to drop the column `deleted_time` on the `attachments_table` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `provider_id` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `users` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "users_provider_provider_id_key";

-- AlterTable
ALTER TABLE "access_token" ADD COLUMN     "last_modified_time" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "attachments" ALTER COLUMN "last_modified_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "attachments_table" DROP COLUMN "deleted_time",
ADD COLUMN     "last_modified_time" TIMESTAMP(3),
ALTER COLUMN "last_modified_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "automation_workflow" ALTER COLUMN "last_modified_time" DROP NOT NULL,
ALTER COLUMN "last_modified_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "automation_workflow_action" ALTER COLUMN "last_modified_time" DROP NOT NULL,
ALTER COLUMN "last_modified_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "automation_workflow_trigger" ALTER COLUMN "last_modified_time" DROP NOT NULL,
ALTER COLUMN "last_modified_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "base" ADD COLUMN     "last_modified_time" TIMESTAMP(3),
ALTER COLUMN "last_modified_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "collaborator" ALTER COLUMN "last_modified_time" DROP NOT NULL,
ALTER COLUMN "last_modified_time" DROP DEFAULT,
ALTER COLUMN "last_modified_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "field" ALTER COLUMN "last_modified_time" DROP NOT NULL,
ALTER COLUMN "last_modified_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "invitation" ADD COLUMN     "last_modified_by" TEXT,
ADD COLUMN     "last_modified_time" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "space" ADD COLUMN     "last_modified_time" TIMESTAMP(3),
ALTER COLUMN "last_modified_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "table_meta" ALTER COLUMN "last_modified_time" DROP NOT NULL,
ALTER COLUMN "last_modified_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "provider",
DROP COLUMN "provider_id",
DROP COLUMN "updated_at",
ALTER COLUMN "last_modified_time" DROP NOT NULL;

-- AlterTable
ALTER TABLE "view" ALTER COLUMN "last_modified_time" DROP NOT NULL,
ALTER COLUMN "last_modified_by" DROP NOT NULL;

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_provider_provider_id_key" ON "account"("provider", "provider_id");

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
