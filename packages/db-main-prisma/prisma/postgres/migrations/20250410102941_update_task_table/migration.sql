/*
  Warnings:

  - Added the required column `created_by` to the `task` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "task" ADD COLUMN     "created_by" TEXT NOT NULL,
ADD COLUMN     "last_modified_by" TEXT,
ADD COLUMN     "last_modified_time" TIMESTAMP(3);
