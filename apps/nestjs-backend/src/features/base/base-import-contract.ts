export interface IBaseImportProgress {
  phase: string;
  detail?: string;
  tableId?: string;
  tableName?: string;
  tableIndex?: number;
  totalTables?: number;
  totalRows?: number;
  processedRows?: number;
  batchProcessedRows?: number;
  currentBatch?: number;
}

export type BaseImportProgressCallback = (
  phase: string | IBaseImportProgress,
  detail?: string
) => void;

export interface IBaseHostIdMaps {
  appIdMap: Record<string, string>;
  workflowIdMap: Record<string, string>;
  routineIdMap: Record<string, string>;
  dashboardIdMap: Record<string, string>;
  folderIdMap: Record<string, string>;
  nodeIdMap: Record<string, string>;
}

export const formatBaseImportError = (error: unknown, fallback = 'Import failed'): string => {
  if (typeof error === 'string') {
    return error.trim() || fallback;
  }

  if (error && typeof error === 'object') {
    return formatBaseImportObjectError(error, fallback);
  }

  return fallback;
};

const stringifyErrorDetails = (details: unknown): string | undefined => {
  if (details === undefined || details === null) {
    return undefined;
  }
  if (typeof details === 'string') {
    return details.trim() || undefined;
  }
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
};

const formatBaseImportObjectError = (error: object, fallback: string): string => {
  const candidate = error as {
    code?: unknown;
    details?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const message = typeof candidate.message === 'string' ? candidate.message.trim() : '';
  const code = typeof candidate.code === 'string' ? candidate.code.trim() : '';
  const details = stringifyErrorDetails(candidate.details);

  if (message) {
    return code ? `${message} (${code})` : message;
  }
  if (code) {
    return details ? `${fallback}: ${code} - ${details}` : `${fallback}: ${code}`;
  }
  if (error instanceof Error && typeof candidate.name === 'string' && candidate.name !== 'Error') {
    return `${fallback}: ${candidate.name}`;
  }
  return fallback;
};
