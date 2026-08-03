-- Drop the existing unique index on node_id
DROP INDEX IF EXISTS "base_share_node_id_key";

-- Make node_id nullable
ALTER TABLE "base_share" ALTER COLUMN "node_id" DROP NOT NULL;

-- Add compound unique on (base_id, node_id) for node-level shares
CREATE UNIQUE INDEX "base_share_base_id_node_id_key" ON "base_share"("base_id", "node_id");

-- Add partial unique index to ensure only one whole-base share per base (where node_id IS NULL)
CREATE UNIQUE INDEX "base_share_base_id_whole_base_key" ON "base_share"("base_id") WHERE "node_id" IS NULL;
