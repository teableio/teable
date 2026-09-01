import { type DomainError, type Field } from '@teable/v2-core';
import { sql, type RawBuilder } from 'kysely';
import { ok, type Result } from 'neverthrow';

export type StoredFieldValueExpression = {
  readonly expression: RawBuilder<unknown>;
  readonly usesErrorFallback: boolean;
};

// Whitelist: dbFieldType is persisted metadata and must never be interpolated
// into raw SQL. Unknown or legacy values fall back to an uncast NULL.
const NULL_CAST_TYPE_BY_DB_FIELD_TYPE: Readonly<Record<string, string>> = {
  JSON: 'jsonb',
  REAL: 'double precision',
  DATETIME: 'timestamptz',
  BOOLEAN: 'boolean',
  TEXT: 'text',
  INTEGER: 'integer',
};

const buildTypedNullExpression = (field: Field): Result<RawBuilder<unknown>, DomainError> =>
  field
    .dbFieldType()
    .andThen((dbFieldType) => dbFieldType.value())
    .map((dbFieldType) => {
      const castType = NULL_CAST_TYPE_BY_DB_FIELD_TYPE[dbFieldType.trim().toUpperCase()];
      return castType === undefined ? sql.raw('NULL') : sql.raw(`NULL::${castType}`);
    })
    .orElse(() =>
      field
        .isMultipleCellValue()
        .map((multiplicity) => sql.raw(multiplicity.isMultiple() ? 'NULL::jsonb' : 'NULL'))
    );

/**
 * Resolve the effective stored read expression for every SQL consumer.
 *
 * Errored computed fields must behave as NULL even when a stale physical value
 * remains in PostgreSQL. Keeping this policy here prevents stored projection,
 * ordering, grouping, and search from disagreeing about the same record value.
 */
export const buildStoredFieldValueExpression = (
  field: Field,
  tableAlias: string,
  column: string
): Result<StoredFieldValueExpression, DomainError> => {
  if (field.computed().toBoolean() && field.hasError().isError()) {
    return buildTypedNullExpression(field).map((expression) => ({
      expression,
      usesErrorFallback: true,
    }));
  }

  return ok({
    expression: sql.ref(`${tableAlias}.${column}`),
    usesErrorFallback: false,
  });
};
