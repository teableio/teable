import { getPostgresSqlExecutionDiagnostics } from './PostgresSqlExecutionError';

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const MAX_CAUSE_DEPTH = 5;

const sqlState = (value: unknown): string | undefined =>
  typeof value === 'string' && SQLSTATE_PATTERN.test(value) ? value : undefined;

/**
 * Extract the PostgreSQL SQLSTATE from any error shape the data plane throws:
 * raw pg errors (`error.code`), PostgresSqlExecutionError diagnostics, or a
 * bounded walk through `cause` chains. DomainError codes are ignored because
 * they are not five-character SQLSTATEs.
 */
export const pgErrorCode = (error: unknown, depth = 0): string | undefined => {
  if (!error || typeof error !== 'object' || depth > MAX_CAUSE_DEPTH) return undefined;

  if ('code' in error) {
    const direct = sqlState(error.code);
    if (direct) return direct;
  }

  const wrapped = sqlState(getPostgresSqlExecutionDiagnostics(error)?.postgres?.sqlState);
  if (wrapped) return wrapped;

  if ('cause' in error) {
    return pgErrorCode(error.cause, depth + 1);
  }
  return undefined;
};
