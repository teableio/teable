/*
  Warnings:

  - You are about to drop the column `icon_meta` on the `notification` table. All the data in the column will be lost.
  - Added the required column `from_user_id` to the `notification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `to_user_id` to the `notification` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "notification_to_user_is_read_created_time_idx";

-- AlterTable
ALTER TABLE "notification" DROP COLUMN "icon_meta",
ADD COLUMN     "from_user_id" TEXT NOT NULL,
ADD COLUMN     "to_user_id" TEXT NOT NULL,
ALTER COLUMN "from_user" DROP NOT NULL,
ALTER COLUMN "to_user" DROP NOT NULL,
ALTER COLUMN "url_meta" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "notification_to_user_id_is_read_created_time_idx" ON "notification"("to_user_id", "is_read", "created_time");
