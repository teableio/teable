-- CreateTable
CREATE TABLE "integration" (
    "id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enable" BOOLEAN,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMP(3),

    CONSTRAINT "integration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_resource_id_key" ON "integration"("resource_id");
