import { tableI18nKeys } from '@teable/i18n-keys';
import {
  domainError,
  isDomainError,
  type DomainError,
  type Field,
  type IExecutionContext,
} from '@teable/v2-core';

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

export type DatabaseOperation = 'insert' | 'update' | 'delete' | 'query';

export interface WrapDatabaseErrorContext {
  tableName: string;
  recordId?: string;
  count?: number;
  fields?: ReadonlyArray<Field>;
}

const i18nOrFallback = (
  t: IExecutionContext['$t'],
  key: Parameters<NonNullable<IExecutionContext['$t']>>[0],
  fallback: string,
  options?: Record<string, unknown>
): string => {
  if (!t) {
    return fallback;
  }
  try {
    return t(key, options);
  } catch {
    return fallback;
  }
};

/**
 * Extract the column name from a PostgreSQL not-null violation error.
 * PG includes the `column` property on 23502 errors.
 */
export const extractNotNullColumn = (error: unknown): string | undefined => {
  if (error && typeof error === 'object' && 'column' in error) {
    const col = (error as { column?: string }).column;
    return typeof col === 'string' && col.length > 0 ? col : undefined;
  }
  return undefined;
};

/**
 * Extract the column name from a PostgreSQL unique violation constraint name.
 * Constraint names follow the pattern `${tableName}_${columnName}_unique`
 * (matching `ColumnUniqueConstraintRule.getIndexName`).
 */
export const extractUniqueColumn = (error: unknown, tableName: string): string | undefined => {
  if (error && typeof error === 'object' && 'constraint' in error) {
    const constraint = (error as { constraint?: string }).constraint;
    if (typeof constraint !== 'string') return undefined;
    // tableName may be schema-qualified ("schema.table"); constraint uses plain table name only
    const plainTable = tableName.includes('.')
      ? tableName.slice(tableName.indexOf('.') + 1)
      : tableName;
    const prefix = `${plainTable}_`;
    const suffix = '_unique';
    if (constraint.startsWith(prefix) && constraint.endsWith(suffix)) {
      const col = constraint.slice(prefix.length, -suffix.length);
      return col.length > 0 ? col : undefined;
    }
  }
  return undefined;
};

/**
 * Find the field whose DB column name matches the given column.
 */
const findFieldByColumn = (
  column: string | undefined,
  fields: ReadonlyArray<Field> | undefined
): Field | undefined => {
  if (!column || !fields) return undefined;
  return fields.find((f) => {
    const result = f.dbFieldName().andThen((name) => name.value());
    return result.isOk() && result.value === column;
  });
};

/**
 * Wrap database errors into appropriate domain errors.
 * Converts PostgreSQL constraint violations into validation errors.
 */
export const wrapDatabaseError = (
  error: unknown,
  operation: DatabaseOperation,
  context: WrapDatabaseErrorContext,
  t?: IExecutionContext['$t']
): DomainError => {
  // Check for link field unique constraint violation
  if (isLinkUniqueViolation(error)) {
    return domainError.validation({
      message: i18nOrFallback(
        t,
        tableI18nKeys.validation.link.one_one_duplicate,
        `Cannot complete ${operation}: the target record is already linked by another record in a one-to-one relationship`
      ),
      code: 'validation.link.one_one_duplicate',
    });
  }

  if (isUniqueViolation(error)) {
    const column = extractUniqueColumn(error, context.tableName);
    const field = findFieldByColumn(column, context.fields);
    const fieldId = field?.id().toString();
    return domainError.validation({
      message: `Cannot complete ${operation}: field ${fieldId ?? ''} must have a unique value`,
      code: 'validation.field.unique',
      ...(field && { details: { fieldId, fieldName: field.name().toString() } }),
    });
  }

  if (isNotNullViolation(error)) {
    const column = extractNotNullColumn(error);
    const field = findFieldByColumn(column, context.fields);
    const fieldId = field?.id().toString();
    return domainError.validation({
      message: `Cannot complete ${operation}: field ${fieldId ?? ''} cannot be empty`,
      code: 'validation.field.not_null',
      ...(field && { details: { fieldId, fieldName: field.name().toString() } }),
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
