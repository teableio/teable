-- AlterTable
ALTER TABLE "space" ADD COLUMN     "is_template" BOOLEAN;

-- CreateTable
CREATE TABLE "template" (
    "id" TEXT NOT NULL,
    "base_id" TEXT,
    "cover" TEXT,
    "name" TEXT,
    "description" TEXT,
    "category_id" TEXT,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_time" TIMESTAMP(3),
    "last_modified_by" TEXT,
    "is_system" BOOLEAN,
    "is_published" BOOLEAN,
    "snapshot" TEXT,
    "order" DOUBLE PRECISION NOT NULL,
    "usage_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_time" TIMESTAMP(3),
    "last_modified_by" TEXT,
    "order" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "template_category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "template_category_name_key" ON "template_category"("name");
