-- AlterTable: Change attachments.size from INTEGER (4 bytes) to BIGINT (8 bytes)
-- to support attachments larger than 2GB.
ALTER TABLE "attachments" ALTER COLUMN "size" SET DATA TYPE BIGINT;
