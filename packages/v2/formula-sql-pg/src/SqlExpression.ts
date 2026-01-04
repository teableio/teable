import type { Field } from '@teable/v2-core';

export type SqlValueType = 'string' | 'number' | 'boolean' | 'datetime' | 'unknown';
export type SqlStorageKind = 'scalar' | 'json' | 'array';

export type SqlExpr = {
  valueSql: string;
  valueType: SqlValueType;
  isArray: boolean;
  storageKind?: SqlStorageKind;
  errorConditionSql?: string;
  errorMessageSql?: string;
  field?: Field;
};

export const makeExpr = (
  valueSql: string,
  valueType: SqlValueType,
  isArray = false,
  errorConditionSql?: string,
  errorMessageSql?: string,
  field?: Field,
  storageKind?: SqlStorageKind
): SqlExpr => ({
  valueSql,
  valueType,
  isArray,
  storageKind,
  errorConditionSql,
  errorMessageSql,
  field,
});

export const combineErrorConditions = (exprs: ReadonlyArray<SqlExpr>): string | undefined => {
  const conditions = exprs
    .map((expr) => expr.errorConditionSql)
    .filter((condition): condition is string => Boolean(condition));
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return `(${conditions.join(' OR ')})`;
};

export const buildErrorMessageSql = (
  exprs: ReadonlyArray<SqlExpr>,
  fallbackMessageSql: string
): string | undefined => {
  const entries = exprs
    .map((expr) => ({
      condition: expr.errorConditionSql,
      message: expr.errorMessageSql ?? fallbackMessageSql,
    }))
    .filter((entry): entry is { condition: string; message: string } => Boolean(entry.condition));
  if (entries.length === 0) return undefined;
  const cases = entries.map((entry) => `WHEN ${entry.condition} THEN ${entry.message}`).join(' ');
  return `CASE ${cases} ELSE ${fallbackMessageSql} END`;
};

export const guardValueSql = (valueSql: string, errorConditionSql?: string): string => {
  if (!errorConditionSql) return valueSql;
  return `(CASE WHEN ${errorConditionSql} THEN NULL ELSE ${valueSql} END)`;
};

export const withError = (
  expr: SqlExpr,
  errorConditionSql: string,
  errorMessageSql: string
): SqlExpr => ({
  ...expr,
  errorConditionSql: expr.errorConditionSql
    ? `(${expr.errorConditionSql} OR ${errorConditionSql})`
    : errorConditionSql,
  errorMessageSql: expr.errorMessageSql ?? errorMessageSql,
});
