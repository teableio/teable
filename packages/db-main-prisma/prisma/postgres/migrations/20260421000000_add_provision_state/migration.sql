DO $$
BEGIN
  CREATE TYPE "ProvisionState" AS ENUM ('pending', 'ready', 'error', 'deleting');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "base"
  ADD COLUMN IF NOT EXISTS "provision_state" "ProvisionState" NOT NULL DEFAULT 'ready';

ALTER TABLE "table_meta"
  ADD COLUMN IF NOT EXISTS "provision_state" "ProvisionState" NOT NULL DEFAULT 'ready';

ALTER TABLE "field"
  ADD COLUMN IF NOT EXISTS "provision_state" "ProvisionState" NOT NULL DEFAULT 'ready';
