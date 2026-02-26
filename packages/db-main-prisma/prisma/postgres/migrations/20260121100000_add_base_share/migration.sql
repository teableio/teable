-- CreateTable
CREATE TABLE "base_share" (
    "id" TEXT NOT NULL,
    "base_id" TEXT NOT NULL,
    "share_id" TEXT NOT NULL,
    "password" TEXT,
    "node_id" TEXT NOT NULL,
    "allow_save" BOOLEAN,
    "allow_copy" BOOLEAN,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_time" TIMESTAMP(3),

    CONSTRAINT "base_share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "base_share_share_id_key" ON "base_share"("share_id");

-- CreateIndex
CREATE UNIQUE INDEX "base_share_node_id_key" ON "base_share"("node_id");

-- CreateIndex
CREATE INDEX "base_share_base_id_idx" ON "base_share"("base_id");
