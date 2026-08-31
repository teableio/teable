export const parseLinkFieldOptions = (options: string | null): { foreignTableId?: string } => {
  if (!options) {
    return {};
  }
  try {
    return JSON.parse(options) as { foreignTableId?: string };
  } catch {
    return {};
  }
};

export const isLinkEntry = (value: unknown): value is { id: string } =>
  typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string';

// link target ids of a link cell value; unrecognized shapes contribute nothing
export const collectLinkTargetIds = (cellValue: unknown): string[] => {
  if (Array.isArray(cellValue)) {
    return cellValue.filter(isLinkEntry).map((entry) => entry.id);
  }
  return isLinkEntry(cellValue) ? [cellValue.id] : [];
};
