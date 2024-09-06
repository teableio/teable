-- CreateTable
CREATE TABLE "trash" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "deleted_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_by" TEXT NOT NULL,

    CONSTRAINT "trash_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trash_resource_type_resource_id_key" ON "trash"("resource_type", "resource_id");
