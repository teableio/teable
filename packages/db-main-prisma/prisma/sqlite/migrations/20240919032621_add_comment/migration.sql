-- CreateTable
CREATE TABLE "comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "quote_Id" TEXT,
    "content" TEXT,
    "reaction" TEXT,
    "deleted_time" DATETIME,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_time" DATETIME
);

-- CreateTable
CREATE TABLE "comment_subscription" (
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "comment_table_id_record_id_idx" ON "comment"("table_id", "record_id");

-- CreateIndex
CREATE INDEX "comment_subscription_table_id_record_id_idx" ON "comment_subscription"("table_id", "record_id");

-- CreateIndex
CREATE UNIQUE INDEX "comment_subscription_table_id_record_id_key" ON "comment_subscription"("table_id", "record_id");
