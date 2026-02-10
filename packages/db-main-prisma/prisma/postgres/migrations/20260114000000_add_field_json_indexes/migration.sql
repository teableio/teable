-- Expression indexes for field dependency lookups
-- These indexes optimize queries that search for fields by their JSON config dependencies

-- Index for lookup/rollup fields: lookup_options->>'linkFieldId'
CREATE INDEX IF NOT EXISTS "field_lookup_options_link_field_id_idx"
  ON "field" (((lookup_options::jsonb)->>'linkFieldId'))
  WHERE lookup_options IS NOT NULL AND deleted_time IS NULL;

-- Index for lookup/rollup fields: lookup_options->>'lookupFieldId'
CREATE INDEX IF NOT EXISTS "field_lookup_options_lookup_field_id_idx"
  ON "field" (((lookup_options::jsonb)->>'lookupFieldId'))
  WHERE lookup_options IS NOT NULL AND deleted_time IS NULL;

-- Index for link fields: options->>'lookupFieldId'
CREATE INDEX IF NOT EXISTS "field_options_lookup_field_id_idx"
  ON "field" (((options::jsonb)->>'lookupFieldId'))
  WHERE options IS NOT NULL AND type = 'link' AND deleted_time IS NULL;
