/*
  Warnings:

  - You are about to drop the column `user_id` on the `collaborator` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[resource_type,resource_id,principal_id,principal_type]` on the table `collaborator` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `principal_id` to the `collaborator` table without a default value. This is not possible if the table is not empty.
  - Added the required column `principal_type` to the `collaborator` table without a default value. This is not possible if the table is not empty.

*/

BEGIN;

-- DropIndex
DROP INDEX "collaborator_resource_type_resource_id_user_id_key";

-- AlterTable
ALTER TABLE "collaborator"
ADD COLUMN     "principal_id" TEXT NOT NULL,
ADD COLUMN     "principal_type" TEXT NOT NULL;

UPDATE "collaborator" 
SET principal_id = user_id,
    principal_type = 'user'
WHERE user_id IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "collaborator_resource_type_resource_id_principal_id_princip_key" ON "collaborator"("resource_type", "resource_id", "principal_id", "principal_type");

-- AddForeignKey
ALTER TABLE "collaborator" ADD CONSTRAINT "collaborator_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "collaborator" DROP CONSTRAINT "collaborator_user_id_fkey";

ALTER TABLE "collaborator" DROP COLUMN "user_id";

COMMIT;