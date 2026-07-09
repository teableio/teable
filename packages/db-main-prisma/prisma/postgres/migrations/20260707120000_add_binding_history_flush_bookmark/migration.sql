-- record-history cold storage: per-binding flush bookmark so the daily
-- flusher can skip idle BYODB tenant dbs without connecting to them
ALTER TABLE "space_data_db_binding" ADD COLUMN "last_history_flushed_at" TIMESTAMP(3);
