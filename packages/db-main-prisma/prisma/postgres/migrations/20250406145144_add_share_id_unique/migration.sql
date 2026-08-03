/*
  Warnings:

  - A unique constraint covering the columns `[share_id]` on the table `view` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "view_share_id_key" ON "view"("share_id");
