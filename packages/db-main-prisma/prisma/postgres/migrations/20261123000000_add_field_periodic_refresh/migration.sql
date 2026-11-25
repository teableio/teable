-- AlterTable: static periodic refresh metadata flags on field (never mutated by scheduled ticks)
ALTER TABLE "field" ADD COLUMN "needs_periodic_refresh" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "refresh_cadence" VARCHAR(16);

-- CreateTable: high-frequency runtime periodic refresh state sidecar table
CREATE TABLE "field_periodic_refresh_state" (
    "field_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "base_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "time_zone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "contains_now_precision" BOOLEAN NOT NULL DEFAULT false,
    "last_refreshed_at" TIMESTAMPTZ(6),
    "last_refreshed_local_date" VARCHAR(16),
    "last_range_hash" VARCHAR(128),
    "last_status" VARCHAR(32) NOT NULL DEFAULT 'idle',
    "last_error" TEXT,
    "created_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMPTZ(6),

    CONSTRAINT "field_periodic_refresh_state_pkey" PRIMARY KEY ("field_id")
);

-- CreateIndex
CREATE INDEX "field_periodic_refresh_state_base_id_enabled_idx" ON "field_periodic_refresh_state"("base_id", "enabled");

-- CreateIndex
CREATE INDEX "field_periodic_refresh_state_table_id_idx" ON "field_periodic_refresh_state"("table_id");

-- CreateIndex
CREATE INDEX "field_periodic_refresh_state_enabled_local_date_idx" ON "field_periodic_refresh_state"("enabled", "last_refreshed_local_date");

-- AddForeignKey
ALTER TABLE "field_periodic_refresh_state" ADD CONSTRAINT "field_periodic_refresh_state_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "field"("id") ON DELETE CASCADE ON UPDATE CASCADE;
