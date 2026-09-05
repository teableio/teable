-- Pause leases may admit or block computed-producing writes.
-- Additive default keeps existing rows on the previous allow_bounded behavior.

ALTER TABLE "computed_update_pause_scope"
    ADD COLUMN IF NOT EXISTS "write_policy" TEXT NOT NULL DEFAULT 'allow_bounded';
