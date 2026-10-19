/**
 * Whether a cell value counts as "no value".
 *
 * Write paths normalise the cleared forms to `null` (T6520: an explicit `''`,
 * `false` or `[]` is a clear), so this predicate is the same answer for both a
 * stored value and a request payload that reached the domain.
 */
export const isEmptyCellValue = (value: unknown): boolean => {
  if (value == null) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};
