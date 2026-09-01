// The ways a cold read can fail, in one module because the read paths act on
// the distinction: deadline and degraded store both mean "could not finish"
// (partial page, else 503), a missing part means "skip it", anything else is a
// defect and must stay a 500.

/** thrown when a part download outlives the caller's read deadline */
export class ColdReadDeadlineError extends Error {}

/** thrown when the object store fails the read: throttling, 5xx, dropped connection */
export class ColdStorageUnavailableError extends Error {}

/** a part named by a listing or by stats that the store no longer holds */
export const isMissingPartError = (error: unknown): boolean => {
  const candidate = error as { name?: string; code?: string; message?: string } | undefined;
  const signature = `${candidate?.name ?? ''} ${candidate?.code ?? ''} ${candidate?.message ?? ''}`;
  // word-bounded: a bare /NotFound/ would swallow the DNS errno ENOTFOUND,
  // which is a transient failure, not a missing object
  return /NoSuchKey|\bNotFound\b|\bENOENT\b|does not exist|\b404\b/i.test(signature);
};

const TRANSIENT_S3_CODES = new Set([
  'SlowDown',
  'InternalError',
  'ServiceUnavailable',
  'RequestTimeout',
  'RequestTimeTooSkewed',
]);

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/** narrow on purpose: a missing or malformed key is a defect, not something a retry fixes */
export const isTransientStorageFailure = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (isMissingPartError(error)) return false;
  const { code, statusCode, $metadata } = error as Error & {
    code?: string;
    statusCode?: number;
    $metadata?: { httpStatusCode?: number };
  };
  if (code && (TRANSIENT_S3_CODES.has(code) || TRANSIENT_NETWORK_CODES.has(code))) return true;
  // AWS SDK v3 carries the service error code in `name` and the status in `$metadata`
  if (TRANSIENT_S3_CODES.has(error.name)) return true;
  const status = statusCode ?? $metadata?.httpStatusCode;
  if (typeof status === 'number' && status >= 500) return true;
  return /socket hang up|aborted/i.test(error.message);
};

/** READ paths only — the flusher needs the raw error to choose retry vs fold-back */
export const coldStorageRead = async <T>(op: () => Promise<T>): Promise<T> => {
  try {
    return await op();
  } catch (error) {
    if (!isTransientStorageFailure(error)) throw error;
    throw new ColdStorageUnavailableError(
      `cold storage read failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/** both ways a cold read ends early without being a defect */
export const isColdReadInterrupted = (error: unknown): boolean =>
  error instanceof ColdReadDeadlineError || error instanceof ColdStorageUnavailableError;
