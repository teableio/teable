export const normalizeStoredLinkItems = (
  rawValue: unknown
): Array<{ id: string; title?: string }> => {
  if (rawValue == null) {
    return [];
  }

  const items = Array.isArray(rawValue) ? rawValue : [rawValue];
  return items.filter(
    (item): item is { id: string; title?: string } =>
      !!item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'
  );
};
