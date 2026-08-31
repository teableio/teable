import { sdkErrorI18nKeys } from '@teable/i18n-keys';
import { domainError, isDomainError, type DomainError, type Field } from '@teable/v2-core';

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
 * PostgreSQL error code for foreign key constraint violation.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PG_FOREIGN_KEY_VIOLATION = '23503';

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
 * Check if an error is a PostgreSQL foreign key constraint violation.
 */
export const isForeignKeyViolation = (error: unknown): boolean => {
  if (error && typeof error === 'object' && 'code' in error) {
    const pgError = error as { code?: string };
    return pgError.code === PG_FOREIGN_KEY_VIOLATION;
  }
  return false;
};

/**
 * Extract the link field id from a link FK constraint name (`fk___fk_<fieldId>`).
 */
export const extractForeignKeyFieldId = (error: unknown): string | undefined => {
  if (error && typeof error === 'object' && 'constraint' in error) {
    const constraint = (error as { constraint?: string }).constraint;
    if (typeof constraint === 'string' && constraint.startsWith('fk___fk_')) {
      const fieldId = constraint.slice('fk___fk_'.length);
      return fieldId.length > 0 ? fieldId : undefined;
    }
  }
  return undefined;
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
 * Extract the column name from a PostgreSQL unique violation.
 * Prefers `detail` (`Key (column)=(...) already exists.`), then the v2
 * `${tableName}_${columnName}_unique` constraint name.
 */
export const extractUniqueColumn = (error: unknown, tableName: string): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;

  if ('detail' in error && typeof error.detail === 'string') {
    const match = /^Key \((?:"([^"]+)"|([^)]+))\)=/.exec(error.detail);
    const column = match?.[1] ?? match?.[2];
    if (column && column.length > 0) return column;
  }

  if (!('constraint' in error) || typeof error.constraint !== 'string') return undefined;
  const constraint = error.constraint;
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
  return undefined;
};

/**
 * Extract a field id from a v1 unique index name.
 * v1 names are `${schema}_${table}___${fieldId}_unique`, lowercased and
 * truncated to 63 bytes (`FieldService.getFieldUniqueKeyName`).
 */
export const extractUniqueFieldId = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object' || !('constraint' in error)) return undefined;
  if (typeof error.constraint !== 'string') return undefined;
  const match = /___((?:fld)[0-9a-z]+)_unique$/i.exec(error.constraint);
  const fieldId = match?.[1];
  return fieldId && fieldId.length > 0 ? fieldId : undefined;
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

const findFieldById = (
  fieldId: string | undefined,
  fields: ReadonlyArray<Field> | undefined
): Field | undefined => {
  if (!fieldId || !fields) return undefined;
  const needle = fieldId.toLowerCase();
  return fields.find((f) => f.id().toString().toLowerCase() === needle);
};

const resolveUniqueField = (
  error: unknown,
  tableName: string,
  fields: ReadonlyArray<Field> | undefined
): Field | undefined => {
  return (
    findFieldByColumn(extractUniqueColumn(error, tableName), fields) ??
    findFieldById(extractUniqueFieldId(error), fields)
  );
};

export const createSchemaUniqueViolationError = (
  error: unknown,
  tableName: string,
  fields: ReadonlyArray<Field> | undefined
): DomainError => {
  const field = resolveUniqueField(error, tableName, fields);
  const fieldId = field?.id().toString();
  const fieldName = field?.name().toString();

  return domainError.validation({
    message: fieldName
      ? `Cannot mark field "${fieldName}" as unique because existing records contain duplicate values.`
      : 'Cannot mark this field as unique because existing records contain duplicate values.',
    code: 'validation.field.unique_existing_values',
    ...(field && { details: { fieldId, fieldName } }),
    ...(fieldName && {
      localization: {
        i18nKey: sdkErrorI18nKeys.custom.fieldUniqueExistingValues,
        context: { fieldName },
      },
    }),
  });
};

export const createSchemaNotNullViolationError = (
  error: unknown,
  fields: ReadonlyArray<Field> | undefined
): DomainError => {
  const column = extractNotNullColumn(error);
  const field = findFieldByColumn(column, fields);
  const fieldId = field?.id().toString();
  const fieldName = field?.name().toString();

  return domainError.validation({
    message: fieldName
      ? `Cannot mark field "${fieldName}" as required because existing records contain empty values.`
      : 'Cannot mark this field as required because existing records contain empty values.',
    code: 'validation.field.required_existing_values',
    ...(field && { details: { fieldId, fieldName } }),
    ...(fieldName && {
      localization: {
        i18nKey: sdkErrorI18nKeys.custom.fieldRequiredExistingValues,
        context: { fieldName },
      },
    }),
  });
};

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
      localization: { i18nKey: sdkErrorI18nKeys.custom.linkOneOneDuplicate },
    });
  }

  // For unique / not-null violations the field may not resolve from the PG
  // constraint metadata; without a field name there is nothing to interpolate,
  // so no localization is attached and the client shows the English message.
  if (isUniqueViolation(error)) {
    const field = resolveUniqueField(error, context.tableName, context.fields);
    const fieldId = field?.id().toString();
    const fieldName = field?.name().toString();
    return domainError.validation({
      message: `Cannot complete ${operation}: field ${fieldId ?? ''} must have a unique value`,
      code: 'validation.field.unique',
      ...(field && { details: { fieldId, fieldName } }),
      ...(fieldName && {
        localization: {
          i18nKey: sdkErrorI18nKeys.custom.recordFieldValueDuplicate,
          context: { fieldName },
        },
      }),
    });
  }

  // Foreign key violations: on delete this is a leftover FK (the app-level
  // pre-check may have been skipped — unknown/malformed constraints — or raced);
  // on insert/update the written link value points at a missing record. Either way
  // it is a data validation problem, not an infrastructure failure. Delete must
  // not claim the referencing field is required: NO ACTION FKs behave like
  // RESTRICT even on optional links.
  if (isForeignKeyViolation(error)) {
    const fieldId = extractForeignKeyFieldId(error);
    if (operation === 'delete') {
      return domainError.validation({
        message: 'Cannot delete record: it is still referenced by a link in another table',
        code: 'validation.link.referenced',
        ...(fieldId && { details: { fieldId, fieldType: 'link' } }),
        localization: {
          i18nKey: sdkErrorI18nKeys.custom.recordDeleteBlockedByRequiredLinkGeneric,
        },
      });
    }
    return domainError.validation({
      message: `Cannot complete ${operation}: a linked record does not exist`,
      code: 'validation.link.invalid_reference',
      ...(fieldId && { details: { fieldId, fieldType: 'link' } }),
    });
  }

  if (isNotNullViolation(error)) {
    const column = extractNotNullColumn(error);
    const field = findFieldByColumn(column, context.fields);
    const fieldId = field?.id().toString();
    const fieldName = field?.name().toString();
    return domainError.validation({
      message: `Cannot complete ${operation}: field ${fieldId ?? ''} cannot be empty`,
      code: 'validation.field.not_null',
      ...(field && { details: { fieldId, fieldName } }),
      ...(fieldName && {
        localization: {
          i18nKey: sdkErrorI18nKeys.custom.recordFieldValueNotNull,
          context: { fieldName },
        },
      }),
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
