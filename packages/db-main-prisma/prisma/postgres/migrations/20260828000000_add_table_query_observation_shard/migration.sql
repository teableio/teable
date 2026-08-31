-- CreateTable
CREATE TABLE IF NOT EXISTS "table_query_observation_shard" (
    "space_id" TEXT,
    "base_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "query_kind" TEXT NOT NULL,
    "shape_hash" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "writer_id" TEXT NOT NULL,
    "window_size_seconds" INTEGER NOT NULL,
    "request_count" INTEGER NOT NULL,
    "slow_count" INTEGER NOT NULL,
    "timeout_count" INTEGER NOT NULL,
    "db_error_count" INTEGER NOT NULL,
    "total_duration_ms" DOUBLE PRECISION NOT NULL,
    "max_duration_ms" DOUBLE PRECISION NOT NULL,
    "total_db_duration_ms" DOUBLE PRECISION,
    "max_db_duration_ms" DOUBLE PRECISION,
    "shape" JSONB NOT NULL,
    "sql_diagnostics" JSONB,
    "created_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMPTZ(6),

    CONSTRAINT "table_query_observation_shard_pkey" PRIMARY KEY ("table_id", "query_kind", "shape_hash", "window_start", "writer_id")
);
DROP INDEX IF EXISTS "table_query_observation_shard_unique_idx";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'table_query_observation_shard'
          AND column_name = 'id'
    ) THEN
        ALTER TABLE "table_query_observation_shard" DROP CONSTRAINT IF EXISTS "table_query_observation_shard_pkey";
        ALTER TABLE "table_query_observation_shard" DROP COLUMN "id";
        ALTER TABLE "table_query_observation_shard" ADD CONSTRAINT "table_query_observation_shard_pkey"
            PRIMARY KEY ("table_id", "query_kind", "shape_hash", "window_start", "writer_id");
    END IF;
END $$;

-- Migrate the pre-shard observation table before removing it.
DO $$
BEGIN
    IF to_regclass(format('%I.%I', current_schema(), 'table_query_observation_window')) IS NOT NULL THEN
        INSERT INTO "table_query_observation_shard" (
            "space_id", "base_id", "table_id", "query_kind", "shape_hash", "window_start",
            "writer_id", "window_size_seconds", "request_count", "slow_count", "timeout_count",
            "db_error_count", "total_duration_ms", "max_duration_ms", "total_db_duration_ms",
            "max_db_duration_ms", "shape", "sql_diagnostics", "created_time", "last_modified_time"
        )
        SELECT
            "space_id", "base_id", "table_id", "query_kind", "shape_hash", "window_start",
            'legacy', "window_size_seconds", "request_count", "slow_count", "timeout_count",
            "db_error_count", "total_duration_ms", "max_duration_ms", "total_db_duration_ms",
            "max_db_duration_ms", "shape", "sql_diagnostics", "created_time", "last_modified_time"
        FROM "table_query_observation_window"
        ON CONFLICT ("table_id", "query_kind", "shape_hash", "window_start", "writer_id") DO NOTHING;

        DROP TABLE "table_query_observation_window";
    END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "table_query_observation_shard_window_start_idx" ON "table_query_observation_shard"("window_start");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "table_query_observation_shard_table_start_idx" ON "table_query_observation_shard"("table_id", "window_start");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "table_query_observation_shard_search_activity_idx" ON "table_query_observation_shard"("query_kind", "table_id", "window_start");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "table_query_observation_shard_base_start_idx" ON "table_query_observation_shard"("base_id", "window_start");
