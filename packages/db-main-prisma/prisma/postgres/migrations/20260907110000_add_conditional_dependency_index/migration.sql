-- Conditional fields keep lookupFieldId in options, outside the link-only index.
CREATE INDEX IF NOT EXISTS "field_options_conditional_lookup_field_id_idx"
  ON "field" (((options::jsonb)->>'lookupFieldId'))
  WHERE options IS NOT NULL
    AND deleted_time IS NULL
    AND type IN ('conditionalRollup', 'conditionalLookup');
