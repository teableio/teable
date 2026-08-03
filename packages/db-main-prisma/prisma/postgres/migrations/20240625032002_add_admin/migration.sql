-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deactivated_time" TIMESTAMP(3),
ADD COLUMN     "is_admin" BOOLEAN;
