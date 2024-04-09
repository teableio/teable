-- AlterTable
BEGIN;

-- Step 1: Add the column, allowing NULL values temporarily
ALTER TABLE "field"
ADD COLUMN "order" DOUBLE PRECISION;

-- Step 2: Set a default value for existing rows
UPDATE "field"
SET "order" = 0
WHERE "order" IS NULL;

-- Step 3: Change the column to NOT NULL now that all rows have a value
ALTER TABLE "field"
ALTER COLUMN "order" SET NOT NULL;

COMMIT;
