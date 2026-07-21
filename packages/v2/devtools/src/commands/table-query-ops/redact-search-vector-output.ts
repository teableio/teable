const sensitiveKeys: Record<string, true> = {
  connection: true,
  sampleSearch: true,
  searchProbe: true,
};

export const redactSearchVectorOutput = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactSearchVectorOutput);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      sensitiveKeys[key] && nestedValue ? '<redacted>' : redactSearchVectorOutput(nestedValue),
    ])
  );
};
