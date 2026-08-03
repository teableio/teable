/*
  Warnings:

  - You are about to drop the column `from_user` on the `notification` table. All the data in the column will be lost.
  - You are about to drop the column `to_user` on the `notification` table. All the data in the column will be lost.
  - You are about to drop the column `url_meta` on the `notification` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "notification" DROP COLUMN "from_user",
DROP COLUMN "to_user",
DROP COLUMN "url_meta",
ADD COLUMN     "url_path" TEXT;
