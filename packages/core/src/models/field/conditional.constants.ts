const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const resolvedMax = parsePositiveInt(process.env.CONDITIONAL_QUERY_MAX_LIMIT, 5000);
const resolvedDefault = parsePositiveInt(process.env.CONDITIONAL_QUERY_DEFAULT_LIMIT, resolvedMax);

export const CONDITIONAL_QUERY_MAX_LIMIT = resolvedMax;
export const CONDITIONAL_QUERY_DEFAULT_LIMIT = Math.min(resolvedDefault, resolvedMax);

export const clampConditionalLimit = (limit?: number | null): number | undefined => {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return undefined;
  }
  const truncated = Math.trunc(limit);
  if (truncated <= 0) {
    return undefined;
  }
  return Math.min(truncated, CONDITIONAL_QUERY_MAX_LIMIT);
};

export const normalizeConditionalLimit = (limit?: number | null): number => {
  return clampConditionalLimit(limit) ?? CONDITIONAL_QUERY_DEFAULT_LIMIT;
};
