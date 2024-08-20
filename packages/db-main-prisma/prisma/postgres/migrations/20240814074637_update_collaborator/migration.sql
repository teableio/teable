/*
  Warnings:

  - You are about to drop the column `base_id` on the `collaborator` table. All the data in the column will be lost.
  - You are about to drop the column `space_id` on the `collaborator` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[resource_type,resource_id,user_id]` on the table `collaborator` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `resource_id` to the `collaborator` table without a default value. This is not possible if the table is not empty.
  - Added the required column `resource_type` to the `collaborator` table without a default value. This is not possible if the table is not empty.

*/
BEGIN;

DELETE FROM "collaborator"
WHERE "deleted_time" IS NOT NULL;

ALTER TABLE "collaborator"
DROP COLUMN "deleted_time";

-- AlterTable
ALTER TABLE "collaborator" ADD COLUMN "resource_id" TEXT,
ADD COLUMN "resource_type" TEXT;

UPDATE "collaborator" SET "resource_id" = "space_id";
UPDATE "collaborator" SET "resource_type" = 'space';

ALTER TABLE "collaborator" DROP COLUMN "base_id",
ALTER COLUMN "resource_id" SET NOT NULL,
ALTER COLUMN "resource_type" SET NOT NULL,
DROP COLUMN "space_id";
-- CreateIndex
CREATE UNIQUE INDEX "collaborator_resource_type_resource_id_user_id_key" ON "collaborator"("resource_type", "resource_id", "user_id");

-- AddForeignKey
ALTER TABLE "collaborator" ADD CONSTRAINT "collaborator_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;