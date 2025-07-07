BEGIN;

CREATE TABLE "setting_backup" AS SELECT * FROM "setting";

-- AlterTable
ALTER TABLE "setting" 
    DROP COLUMN "instance_id",
    DROP COLUMN "disallow_sign_up",
    DROP COLUMN "disallow_space_creation", 
    DROP COLUMN "disallow_space_invitation",
    DROP COLUMN "enable_email_verification",
    DROP COLUMN "ai_config",
    DROP COLUMN "brand_name",
    DROP COLUMN "brand_logo",
    ADD COLUMN "name" TEXT,
    ADD COLUMN "content" TEXT,
    ADD COLUMN "created_by" TEXT,
    ADD COLUMN "created_time" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "last_modified_by" TEXT,
    ADD COLUMN "last_modified_time" TIMESTAMP(3);

DO $$
DECLARE
    old_record RECORD;
BEGIN
    FOR old_record IN (SELECT * FROM "setting_backup" LIMIT 1) LOOP
        IF old_record.disallow_sign_up IS NOT NULL THEN
            INSERT INTO "setting" ("name", "content", "created_by") 
            VALUES ('disallowSignUp', to_json(old_record.disallow_sign_up)::text, 'anonymous');
        END IF;

        IF old_record.disallow_space_creation IS NOT NULL THEN
            INSERT INTO "setting" ("name", "content", "created_by") 
            VALUES ('disallowSpaceCreation', to_json(old_record.disallow_space_creation)::text, 'anonymous');
        END IF;

        IF old_record.disallow_space_invitation IS NOT NULL THEN
            INSERT INTO "setting" ("name", "content", "created_by") 
            VALUES ('disallowSpaceInvitation', to_json(old_record.disallow_space_invitation)::text, 'anonymous');
        END IF;

        IF old_record.enable_email_verification IS NOT NULL THEN
            INSERT INTO "setting" ("name", "content", "created_by") 
            VALUES ('enableEmailVerification', to_json(old_record.enable_email_verification)::text, 'anonymous');
        END IF;

        IF old_record.ai_config IS NOT NULL THEN
            INSERT INTO "setting" ("name", "content", "created_by") 
            VALUES ('aiConfig', old_record.ai_config, 'anonymous');
        END IF;

        IF old_record.brand_name IS NOT NULL THEN
            INSERT INTO "setting" ("name", "content", "created_by") 
            VALUES ('brandName', to_json(old_record.brand_name)::text, 'anonymous');
        END IF;

        IF old_record.brand_logo IS NOT NULL THEN
            INSERT INTO "setting" ("name", "content", "created_by") 
            VALUES ('brandLogo', to_json(old_record.brand_logo)::text, 'anonymous');
        END IF;

        IF old_record.instance_id IS NOT NULL THEN
            INSERT INTO "setting" ("name", "content", "created_by") 
            VALUES ('instanceId', to_json(old_record.instance_id)::text, 'anonymous');
        END IF;
    END LOOP;
END $$;

DELETE FROM "setting" WHERE "name" IS NULL OR "created_by" IS NULL OR "created_time" IS NULL;

ALTER TABLE "setting" 
    ALTER COLUMN "name" SET NOT NULL,
    ALTER COLUMN "created_by" SET NOT NULL,
    ALTER COLUMN "created_time" SET NOT NULL;

CREATE UNIQUE INDEX "setting_name_key" ON "setting"("name");

DROP TABLE IF EXISTS "setting_backup";

COMMIT;


