const displayKeys = ['title', 'name', 'label', 'id'] as const;

const normalizeString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const fromObject = (value: Record<string, unknown>): string | null => {
  for (const key of displayKeys) {
    const candidate = value[key];
    if (typeof candidate === 'string') {
      const normalized = normalizeString(candidate);
      if (normalized) return normalized;
    }
  }

  try {
    const json = JSON.stringify(value);
    if (!json || json === '{}') return null;
    return json;
  } catch {
    return null;
  }
};

export const normalizeCellDisplayValue = (value: unknown): string | null => {
  if (value == null) return null;

  if (typeof value === 'string') {
    return normalizeString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeCellDisplayValue(item);
      if (normalized) return normalized;
    }
    return null;
  }

  if (typeof value === 'object') {
    return fromObject(value as Record<string, unknown>);
  }

  return null;
};

export const normalizeCellDisplayValues = (value: unknown): string[] => {
  if (value == null) return [];

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeCellDisplayValue(item))
      .filter((item): item is string => item != null);
  }

  const normalized = normalizeCellDisplayValue(value);
  return normalized ? [normalized] : [];
};
