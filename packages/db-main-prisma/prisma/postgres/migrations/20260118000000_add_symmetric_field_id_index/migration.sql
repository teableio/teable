-- Index for link fields: options->>'symmetricFieldId'
-- Used in FieldDependencyGraph.findAffectedFieldIds to find symmetric link fields
-- during computed field updates across tables via two-way links.
CREATE INDEX IF NOT EXISTS "field_options_symmetric_field_id_idx"
  ON "field" (((options::jsonb)->>'symmetricFieldId'))
  WHERE options IS NOT NULL AND type = 'link' AND deleted_time IS NULL;
