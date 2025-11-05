BEGIN;
-- 1. clear orphan records in oauth_app_secret (client_id not in oauth_app)
DELETE FROM oauth_app_secret 
WHERE client_id NOT IN (SELECT client_id FROM oauth_app);

-- 2. clear orphan records in oauth_app_token (app_secret_id not in oauth_app_secret)
DELETE FROM oauth_app_token 
WHERE app_secret_id NOT IN (SELECT id FROM oauth_app_secret);

-- 3. clear orphan records in oauth_app_authorized (client_id not in oauth_app)
DELETE FROM oauth_app_authorized 
WHERE client_id NOT IN (SELECT client_id FROM oauth_app);

-- AddForeignKey
ALTER TABLE "oauth_app_authorized" ADD CONSTRAINT "oauth_app_authorized_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_app"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_app_secret" ADD CONSTRAINT "oauth_app_secret_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_app"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_app_token" ADD CONSTRAINT "oauth_app_token_app_secret_id_fkey" FOREIGN KEY ("app_secret_id") REFERENCES "oauth_app_secret"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
