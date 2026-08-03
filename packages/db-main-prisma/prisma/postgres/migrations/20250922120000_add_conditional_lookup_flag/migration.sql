-- Add conditional lookup marker to field table
ALTER TABLE "field"
  ADD COLUMN "is_conditional_lookup" BOOLEAN;
