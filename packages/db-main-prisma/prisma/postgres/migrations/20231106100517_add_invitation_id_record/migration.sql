/*
  Warnings:

  - Added the required column `invitation_id` to the `invitation_record` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "invitation_record" ADD COLUMN     "invitation_id" TEXT NOT NULL;
