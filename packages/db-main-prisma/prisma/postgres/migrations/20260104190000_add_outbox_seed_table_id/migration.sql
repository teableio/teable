-- Add table_id to computed_update_outbox_seed and backfill from computed_update_outbox
ALTER TABLE "computed_update_outbox_seed" ADD COLUMN "table_id" TEXT;

UPDATE "computed_update_outbox_seed" AS s
SET "table_id" = o."seed_table_id"
FROM "computed_update_outbox" AS o
WHERE s."task_id" = o."id" AND s."table_id" IS NULL;

ALTER TABLE "computed_update_outbox_seed" ALTER COLUMN "table_id" SET NOT NULL;

-- Update unique index to include table_id
DROP INDEX IF EXISTS "computed_update_outbox_seed_task_id_record_id_key";
CREATE UNIQUE INDEX "computed_update_outbox_seed_task_id_table_id_record_id_key" ON "computed_update_outbox_seed"("task_id", "table_id", "record_id");
