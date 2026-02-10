import { domainError, isDomainError, type DomainError } from '@teable/v2-core';

export const describeError = (error: unknown): string => {
  if (isDomainError(error)) return error.message;
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};

/**
 * PostgreSQL error code for unique constraint violation.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PG_UNIQUE_VIOLATION = '23505';

/**
 * PostgreSQL error code for not-null constraint violation.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PG_NOT_NULL_VIOLATION = '23502';

/**
 * Check if an error is a PostgreSQL unique constraint violation for link field.
 * Link field foreign key constraints typically contain '__fk_fld' or 'fk_fld' in their names.
 */
export const isLinkUniqueViolation = (error: unknown): boolean => {
  if (error && typeof error === 'object' && 'code' in error) {
    const pgError = error as { code?: string; constraint?: string; message?: string };
    if (pgError.code === PG_UNIQUE_VIOLATION) {
      // Check if it's a link field foreign key constraint
      // Constraint names for link fields typically contain '__fk_fld' or 'index___fk_fld'
      const constraint = pgError.constraint ?? pgError.message ?? '';
      return constraint.includes('__fk_fld') || constraint.includes('fk_fld');
    }
  }
  return false;
};

/**
 * Check if an error is a PostgreSQL unique constraint violation.
 */
export const isUniqueViolation = (error: unknown): boolean => {
  if (error && typeof error === 'object' && 'code' in error) {
    const pgError = error as { code?: string };
    return pgError.code === PG_UNIQUE_VIOLATION;
  }
  return false;
};

/**
 * Check if an error is a PostgreSQL not-null constraint violation.
 */
export const isNotNullViolation = (error: unknown): boolean => {
  if (error && typeof error === 'object' && 'code' in error) {
    const pgError = error as { code?: string };
    return pgError.code === PG_NOT_NULL_VIOLATION;
  }
  return false;
};

export type DatabaseOperation = 'insert' | 'update' | 'delete';

export interface WrapDatabaseErrorContext {
  tableName: string;
  recordId?: string;
  count?: number;
}

/**
 * Wrap database errors into appropriate domain errors.
 * Converts PostgreSQL constraint violations into validation errors.
 */
export const wrapDatabaseError = (
  error: unknown,
  operation: DatabaseOperation,
  context: WrapDatabaseErrorContext
): DomainError => {
  // Check for link field unique constraint violation
  if (isLinkUniqueViolation(error)) {
    return domainError.validation({
      message: `Cannot complete ${operation}: the target record is already linked by another record in a one-to-one relationship`,
      code: 'validation.link.one_one_duplicate',
    });
  }

  if (isUniqueViolation(error)) {
    return domainError.validation({
      message: `Cannot complete ${operation}: unique constraint violated`,
      code: 'validation.field.unique',
    });
  }

  if (isNotNullViolation(error)) {
    return domainError.validation({
      message: `Cannot complete ${operation}: null value violates not-null constraint`,
      code: 'validation.field.not_null',
    });
  }

  // Default: infrastructure error
  const details: Record<string, unknown> = {
    tableName: context.tableName,
    error: describeError(error),
  };
  if (context.recordId) {
    details.recordId = context.recordId;
  }
  if (context.count !== undefined) {
    details.count = context.count;
  }

  const recordNoun = operation === 'delete' && context.count !== undefined ? 'records' : 'record';
  return domainError.infrastructure({
    message: `Failed to ${operation} ${recordNoun}: ${describeError(error)}`,
    code: `infrastructure.database.${operation}_failed`,
    details,
  });
};
