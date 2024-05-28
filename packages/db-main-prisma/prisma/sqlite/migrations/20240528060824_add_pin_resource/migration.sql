/*
  Warnings:

  - Added the required column `order` to the `pin_resource` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_pin_resource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "order" REAL NOT NULL
);
INSERT INTO "new_pin_resource" ("created_by", "created_time", "id", "resource_id", "type") SELECT "created_by", "created_time", "id", "resource_id", "type" FROM "pin_resource";
DROP TABLE "pin_resource";
ALTER TABLE "new_pin_resource" RENAME TO "pin_resource";
CREATE INDEX "pin_resource_order_idx" ON "pin_resource"("order");
CREATE UNIQUE INDEX "pin_resource_created_by_resource_id_key" ON "pin_resource"("created_by", "resource_id");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
