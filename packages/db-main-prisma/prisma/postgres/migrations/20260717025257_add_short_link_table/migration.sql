-- CreateTable
CREATE TABLE "short_link" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "resource_id" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "deleted_time" TIMESTAMP(3),

    CONSTRAINT "short_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "short_link_code_key" ON "short_link"("code");

-- CreateIndex
CREATE UNIQUE INDEX "short_link_type_resource_id_key" ON "short_link"("type", "resource_id");

-- CreateIndex
CREATE INDEX "short_link_deleted_time_idx" ON "short_link"("deleted_time");
