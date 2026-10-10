export const normalizeStoredLinkItems = (
  rawValue: unknown
): Array<{ id: string; title?: string }> => {
  if (rawValue == null) {
    return [];
  }

  const items = Array.isArray(rawValue) ? rawValue : [rawValue];
  return items
    .filter(
      (item): item is { id: string; title?: string | null } =>
        !!item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'
    )
    .map((item) => {
      const title = item.title;
      if (typeof title === 'string') {
        return { id: item.id, title };
      }
      // Drop null/undefined titles so writes match jsonb_strip_nulls storage.
      return { id: item.id };
    });
};

/**
 * A link cell links each foreign record at most once: junction rows are keyed
 * by (self, foreign), so a repeated id would insert the pair twice and the
 * duplicate row then multiplies every aggregate read over that junction.
 * Typecast writes (paste, import, API) skip the domain-level duplicate check,
 * so the write path normalizes the list before the junction INSERT.
 */
export const dedupeLinkItemsById = <T extends { id: string }>(
  items: ReadonlyArray<T>
): Array<T> => {
  const seen = new Set<string>();
  const deduped: Array<T> = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
};
