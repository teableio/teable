/*
  Warnings:

  - Added the required column `doc_type` to the `ops` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ops" ADD COLUMN     "doc_type" TEXT NOT NULL;
