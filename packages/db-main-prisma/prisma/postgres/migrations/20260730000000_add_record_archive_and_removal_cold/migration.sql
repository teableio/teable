-- Record archive and the record-removal cold layer.
--
-- 1) record_trash gains the archive dimension columns and partial indexes: archive reuses the
--    delete orchestration and stores snapshots with reason = 'archived', filtered and sorted
--    on fixed dimensions extracted from the snapshot at write time. ADD COLUMN with a
--    constant default is metadata-only on PG11+, so existing rows are not rewritten, and the
--    partial indexes start empty because every existing row has reason = 'deleted'.
-- 2) The deleted-reason partial indexes serve the recycle bin's merged (PG + S3) record
--    reads, which page keyset-ordered by (created_time DESC, id DESC): operation-scoped for
--    items whose rows carry operation_id (every write since this migration stamps it), and
--    table-scoped for LEGACY items, whose reader walks the deleted timeline and filters item
--    membership app-side.
-- 3) space_data_db_binding gains a per-binding flush bookmark so the daily removal flusher
--    can skip idle BYODB tenant dbs without connecting to them.
-- 4) record_removal_tombstone marks rows already sunk to cold storage that were later
--    restored or purged (S3 parts are immutable, so such a row cannot be deleted in place).
--    Cold reads and the restore fallback filter through this table; the monthly compaction
--    physically drops tombstoned rows when it rewrites month parts.
--
-- The record_trash and record_removal_tombstone statements mirror the db-data-prisma
-- migration of the same name: shared (non-BYODB) deployments host the data-plane tables in
-- the main db, so both migration sets can target the same database — hence IF NOT EXISTS.

ALTER TABLE "record_trash" ADD COLUMN IF NOT EXISTS "reason" TEXT NOT NULL DEFAULT 'deleted';
ALTER TABLE "record_trash" ADD COLUMN IF NOT EXISTS "record_created_time" TIMESTAMP(3);
ALTER TABLE "record_trash" ADD COLUMN IF NOT EXISTS "record_created_by" TEXT;
ALTER TABLE "record_trash" ADD COLUMN IF NOT EXISTS "record_last_modified_time" TIMESTAMP(3);
ALTER TABLE "record_trash" ADD COLUMN IF NOT EXISTS "record_last_modified_by" TEXT;
ALTER TABLE "record_trash" ADD COLUMN IF NOT EXISTS "operation_id" TEXT;

CREATE INDEX IF NOT EXISTS "record_trash_archived_removed_idx"
  ON "record_trash"("table_id", "created_time" DESC, "id" DESC) WHERE "reason" = 'archived';
CREATE INDEX IF NOT EXISTS "record_trash_archived_created_idx"
  ON "record_trash"("table_id", "record_created_time" DESC, "id" DESC) WHERE "reason" = 'archived';
CREATE INDEX IF NOT EXISTS "record_trash_archived_creator_idx"
  ON "record_trash"("table_id", "record_created_by") WHERE "reason" = 'archived';
CREATE INDEX IF NOT EXISTS "record_trash_archived_modified_idx"
  ON "record_trash"("table_id", "record_last_modified_time" DESC, "id" DESC) WHERE "reason" = 'archived';
CREATE INDEX IF NOT EXISTS "record_trash_archived_modifier_idx"
  ON "record_trash"("table_id", "record_last_modified_by") WHERE "reason" = 'archived';

CREATE INDEX IF NOT EXISTS "record_trash_deleted_operation_idx"
  ON "record_trash"("operation_id", "created_time" DESC, "id" DESC)
  WHERE "reason" = 'deleted' AND "operation_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "record_trash_deleted_removed_idx"
  ON "record_trash"("table_id", "created_time" DESC, "id" DESC)
  WHERE "reason" = 'deleted';

ALTER TABLE "space_data_db_binding" ADD COLUMN IF NOT EXISTS "last_removal_flushed_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "record_removal_tombstone" (
    "id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_removal_tombstone_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "record_removal_tombstone_table_id_record_id_idx"
  ON "record_removal_tombstone"("table_id", "record_id");
