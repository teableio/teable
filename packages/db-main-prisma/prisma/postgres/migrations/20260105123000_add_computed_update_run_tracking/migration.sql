-- Add run tracking columns to computed update outbox and dead letter tables

ALTER TABLE "computed_update_outbox" ADD COLUMN "run_id" TEXT;
ALTER TABLE "computed_update_outbox" ADD COLUMN "origin_run_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "computed_update_outbox" ADD COLUMN "run_total_steps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "computed_update_outbox" ADD COLUMN "run_completed_steps_before" INTEGER NOT NULL DEFAULT 0;

UPDATE "computed_update_outbox"
SET "run_id" = "id"
WHERE "run_id" IS NULL;

UPDATE "computed_update_outbox"
SET "origin_run_ids" = ARRAY["run_id"]
WHERE array_length("origin_run_ids", 1) IS NULL;

ALTER TABLE "computed_update_outbox" ALTER COLUMN "run_id" SET NOT NULL;

CREATE INDEX "computed_update_outbox_run_id_idx" ON "computed_update_outbox"("run_id");

ALTER TABLE "computed_update_dead_letter" ADD COLUMN "run_id" TEXT;
ALTER TABLE "computed_update_dead_letter" ADD COLUMN "origin_run_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "computed_update_dead_letter" ADD COLUMN "run_total_steps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "computed_update_dead_letter" ADD COLUMN "run_completed_steps_before" INTEGER NOT NULL DEFAULT 0;

UPDATE "computed_update_dead_letter"
SET "run_id" = "id"
WHERE "run_id" IS NULL;

UPDATE "computed_update_dead_letter"
SET "origin_run_ids" = ARRAY["run_id"]
WHERE array_length("origin_run_ids", 1) IS NULL;

ALTER TABLE "computed_update_dead_letter" ALTER COLUMN "run_id" SET NOT NULL;

CREATE INDEX "computed_update_dead_letter_run_id_idx" ON "computed_update_dead_letter"("run_id");
