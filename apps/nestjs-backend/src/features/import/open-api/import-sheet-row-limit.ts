const importRowLimitErrorCodes = new Set([
  'validation.limit.rows_per_table_max',
  'validation.limit.create_table_records_max',
]);

export type ImportRowLimitError = {
  readonly code?: string;
  readonly details?: Readonly<Record<string, unknown>>;
};

export const getImportRowLimitMax = (error: ImportRowLimitError): number | undefined => {
  if (!error.code || !importRowLimitErrorCodes.has(error.code)) {
    return undefined;
  }
  const max = error.details?.max ?? error.details?.maxRowCount;
  return typeof max === 'number' && Number.isFinite(max) && max > 0 ? Math.floor(max) : undefined;
};

/**
 * If a truncated import still hit a tighter plugin/table cap, retry once with the
 * smaller number. Returning undefined means the current cap already matches.
 */
export const resolveTruncatedSheetRetryCap = (
  currentCap: number | undefined,
  errorCap: number
): number | undefined => {
  const next = currentCap == null ? errorCap : Math.min(currentCap, errorCap);
  if (next <= 0 || next === currentCap) {
    return undefined;
  }
  return next;
};

export const remainingImportRowCount = (
  remaining: number | undefined,
  importedCount: number
): number | undefined => {
  if (remaining == null) {
    return undefined;
  }
  return Math.max(0, remaining - importedCount);
};
