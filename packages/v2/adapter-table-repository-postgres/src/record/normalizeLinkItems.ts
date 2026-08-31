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
