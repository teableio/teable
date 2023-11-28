/*
  Warnings:

  - A unique constraint covering the columns `[to_field_id,from_field_id]` on the table `reference` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "reference_to_field_id_from_field_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "reference_to_field_id_from_field_id_key" ON "reference"("to_field_id", "from_field_id");
