-- Partial index for active link fields used by v2 OrphanedLinkStorageRule integrity scans.
-- Speeds up: SELECT ... FROM field WHERE type = 'link' AND deleted_time IS NULL AND is_lookup IS NULL
CREATE INDEX IF NOT EXISTS "field_active_link_type_idx"
ON "field" ("type")
WHERE "type" = 'link' AND "deleted_time" IS NULL AND "is_lookup" IS NULL;
