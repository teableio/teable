-- Incoming link cleanup includes deleted fields and both null/false lookup flags.
CREATE INDEX IF NOT EXISTS "field_link_foreign_table_id_idx"
ON "field" ((("options"::json)->>'foreignTableId'))
WHERE "type" = 'link' AND ("is_lookup" IS NULL OR "is_lookup" = false);
