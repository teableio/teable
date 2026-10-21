/**
 * The hot half binds a cursor timestamp as a Date, the cold half compares the
 * raw string against part keys — so a parseable but noncanonical form
 * (`2026-01-10T01:00:00+01:00`, a missing `.000`) resumes the two at different
 * positions and duplicates or drops rows in the seam. Rejecting it discards
 * the cursor instead.
 */
export const isCanonicalUtcTimestamp = (value: string): boolean => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
};
