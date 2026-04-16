/*
  Warnings:

  - A unique constraint covering the columns `[account_name]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN "account_name" TEXT NOT NULL DEFAULT (lower(hex(randomblob(16))));

-- CreateIndex
CREATE UNIQUE INDEX "users_account_name_key" ON "users"("account_name");
