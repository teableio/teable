/*
  Warnings:

  - You are about to drop the column `preference_meta` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "preference_meta",
ADD COLUMN     "notify_meta" TEXT;

-- AlterTable
ALTER TABLE "view" ALTER COLUMN "column_meta" DROP DEFAULT;
