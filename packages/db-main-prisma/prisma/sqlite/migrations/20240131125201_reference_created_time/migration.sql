-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_reference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from_field_id" TEXT NOT NULL,
    "to_field_id" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_reference" ("from_field_id", "id", "to_field_id") SELECT "from_field_id", "id", "to_field_id" FROM "reference";
DROP TABLE "reference";
ALTER TABLE "new_reference" RENAME TO "reference";
CREATE INDEX "reference_from_field_id_idx" ON "reference"("from_field_id");
CREATE INDEX "reference_to_field_id_idx" ON "reference"("to_field_id");
CREATE UNIQUE INDEX "reference_to_field_id_from_field_id_key" ON "reference"("to_field_id", "from_field_id");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
