import type { Field } from '@teable/v2-core';
import { sqlText, joinSqlText, type FormulaCompileBudget } from './FormulaCompileBudget';

export type SqlValueType = 'string' | 'number' | 'boolean' | 'datetime' | 'unknown';
export type SqlStorageKind = 'scalar' | 'json' | 'array';

export type SqlExpr = {
  valueSql: string;
  displayValueSql?: string;
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

export const combineErrorConditions = (
  exprs: ReadonlyArray<SqlExpr>,
  budget?: FormulaCompileBudget
): string | undefined => {
  const conditions = exprs
    .map((expr) => expr.errorConditionSql)
    .filter((condition): condition is string => Boolean(condition));
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return (budget?.sql ?? sqlText)`(${joinSqlText(conditions, ' OR ', budget)})`;
};

export const buildErrorMessageSql = (
  exprs: ReadonlyArray<SqlExpr>,
  fallbackMessageSql: string,
  budget?: FormulaCompileBudget
): string | undefined => {
  const entries = exprs
    .map((expr) => ({
      condition: expr.errorConditionSql,
      message: expr.errorMessageSql ?? fallbackMessageSql,
    }))
    .filter((entry): entry is { condition: string; message: string } => Boolean(entry.condition));
  if (entries.length === 0) return undefined;
  const cases = joinSqlText(
    entries.map((entry) => (budget?.sql ?? sqlText)`WHEN ${entry.condition} THEN ${entry.message}`),
    ' ',
    budget
  );
  return (budget?.sql ?? sqlText)`CASE ${cases} ELSE ${fallbackMessageSql} END`;
};

export const guardValueSql = (
  valueSql: string,
  errorConditionSql?: string,
  budget?: FormulaCompileBudget
): string => {
  if (!errorConditionSql) return valueSql;
  return (budget?.sql ?? sqlText)`(CASE WHEN ${errorConditionSql} THEN NULL ELSE ${valueSql} END)`;
};

export const withError = (
  expr: SqlExpr,
  errorConditionSql: string,
  errorMessageSql: string,
  budget?: FormulaCompileBudget
): SqlExpr => ({
  ...expr,
  errorConditionSql: expr.errorConditionSql
    ? (budget?.sql ?? sqlText)`(${expr.errorConditionSql} OR ${errorConditionSql})`
    : errorConditionSql,
  errorMessageSql: expr.errorMessageSql ?? errorMessageSql,
});
