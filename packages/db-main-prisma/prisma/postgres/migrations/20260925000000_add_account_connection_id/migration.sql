-- An account link is keyed by the identity-provider instance that issued the
-- subject: '' for instance-wide providers, the SSO configuration id for
-- enterprise SSO (a subject is only unique per issuer).
ALTER TABLE "account" ADD COLUMN "connection_id" TEXT NOT NULL DEFAULT '';

-- DropIndex
DROP INDEX "account_provider_provider_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "account_provider_provider_id_connection_id_key" ON "account"("provider", "provider_id", "connection_id");
