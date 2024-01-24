-- AlterTable
ALTER TABLE "attachments" ALTER COLUMN "bucket" DROP DEFAULT;

-- AlterTable
ALTER TABLE "field" ADD COLUMN     "is_pending" BOOLEAN;
