BEGIN;

-- Create new table with the desired structure
CREATE TABLE "setting_new" (
    "name" TEXT NOT NULL,
    "content" TEXT,
    "created_by" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_by" TEXT,
    "last_modified_time" DATETIME
);

-- Create unique index on name
CREATE UNIQUE INDEX "setting_name_key" ON "setting_new"("name");

-- Drop old table
DROP TABLE IF EXISTS "setting";   

-- Rename new table to original name
ALTER TABLE "setting_new" RENAME TO "setting";

COMMIT;


