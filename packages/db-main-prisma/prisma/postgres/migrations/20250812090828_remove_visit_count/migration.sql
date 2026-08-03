/*
  Warnings:

  - You are about to drop the column `visit_count` on the `user_last_visit` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "user_last_visit_resource_type_last_visit_time_idx";

-- AlterTable
ALTER TABLE "user_last_visit" DROP COLUMN "visit_count";
