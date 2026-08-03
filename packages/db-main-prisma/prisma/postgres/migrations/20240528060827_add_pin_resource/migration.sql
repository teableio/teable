-- CreateTable
CREATE TABLE "pin_resource" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "order" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "pin_resource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pin_resource_order_idx" ON "pin_resource"("order");

-- CreateIndex
CREATE UNIQUE INDEX "pin_resource_created_by_resource_id_key" ON "pin_resource"("created_by", "resource_id");
