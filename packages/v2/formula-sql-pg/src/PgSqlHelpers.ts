import { sqlText, joinSqlText, type FormulaCompileBudget } from './FormulaCompileBudget';
import type { IPgTypeValidationStrategy } from './PgTypeValidationStrategy';

export type ErrorCode = 'PARSE' | 'REF' | 'TYPE' | 'DIV0' | 'ARG' | 'NOT_IMPL' | 'INTERNAL';

const SQL_TEXT_TYPES = [
  "'text'",
  "'varchar'",
  "'bpchar'",
  "'character varying'",
  "'unknown'",
] as const;

export const escapeSqlLiteral = (value: string, budget?: FormulaCompileBudget): string => {
  if (budget) {
    let bytes = budget.bytes(value);
    for (let index = 0; index < value.length; index++) if (value.charCodeAt(index) === 39) bytes++;
    budget.allocate(bytes);
  }
  return value.replace(/'/g, "''");
};

export const sqlStringLiteral = (value: string, budget?: FormulaCompileBudget): string =>
  (budget?.sql ?? sqlText)`'${escapeSqlLiteral(value, budget)}'`;

export const buildErrorLiteral = (
  code: ErrorCode,
  reason: string,
  budget?: FormulaCompileBudget
): string => sqlStringLiteral((budget?.sql ?? sqlText)`#ERROR:${code}:${reason}`, budget);

export const safeJsonb = (expr: string, budget?: FormulaCompileBudget): string => {
  const baseExpr = (budget?.sql ?? sqlText)`(${expr})`;
  const textTypes = joinSqlText(SQL_TEXT_TYPES, ', ', budget);
  const textSql = (budget?.sql ?? sqlText)`(${baseExpr})::text`;
  const trimmedText = (budget?.sql ?? sqlText)`BTRIM(${textSql})`;
  return (budget?.sql ?? sqlText)`(CASE
    WHEN ${baseExpr} IS NULL THEN NULL
    WHEN pg_typeof(${baseExpr}) = 'jsonb'::regtype THEN to_jsonb(${baseExpr})
    WHEN pg_typeof(${baseExpr}) = 'json'::regtype THEN to_jsonb(${baseExpr})
    WHEN NULLIF(${trimmedText}, '') IS NULL THEN NULL
    WHEN pg_typeof(${baseExpr}) IN (${textTypes}) THEN to_jsonb(${textSql})
    ELSE to_jsonb(${baseExpr})
  END)`;
};

export const safeJsonbWithStrategy = (
  expr: string,
  typeValidation: IPgTypeValidationStrategy,
  budget?: FormulaCompileBudget
): string => {
  const baseExpr = (budget?.sql ?? sqlText)`(${expr})`;
  const textTypes = joinSqlText(SQL_TEXT_TYPES, ', ', budget);
  const textSql = (budget?.sql ?? sqlText)`(${baseExpr})::text`;
  const trimmedText = (budget?.sql ?? sqlText)`BTRIM(${textSql})`;
  const looksJson = (budget?.sql ?? sqlText)`(LEFT(${trimmedText}, 1) IN ('[', '{'))`;
  const jsonValid = typeValidation.isValidForType(textSql, 'jsonb', budget);
  return (budget?.sql ?? sqlText)`(CASE
    WHEN ${baseExpr} IS NULL THEN NULL
    WHEN pg_typeof(${baseExpr}) = 'jsonb'::regtype THEN to_jsonb(${baseExpr})
    WHEN pg_typeof(${baseExpr}) = 'json'::regtype THEN to_jsonb(${baseExpr})
    WHEN pg_typeof(${baseExpr}) IN (${textTypes}) THEN
      CASE
        WHEN NULLIF(${trimmedText}, '') IS NULL THEN NULL
        WHEN ${looksJson} AND ${jsonValid} THEN (${textSql})::jsonb
        ELSE to_jsonb(${textSql})
      END
    ELSE to_jsonb(${baseExpr})
  END)`;
};

/**
 * Normalize an expression to a JSON array.
 *
 * @deprecated Use `normalizeToJsonArrayWithStrategy` instead for PG version compatibility.
 * This function uses `pg_input_is_valid` which is only available in PG 16+.
 */
export const normalizeToJsonArray = (expr: string, budget?: FormulaCompileBudget): string => {
  const baseExpr = (budget?.sql ?? sqlText)`(${expr})`;
  const textTypes = joinSqlText(SQL_TEXT_TYPES, ', ', budget);
  const textSql = (budget?.sql ?? sqlText)`(${baseExpr})::text`;
  const trimmedText = (budget?.sql ?? sqlText)`BTRIM(${textSql})`;
  const looksJson = (budget?.sql ?? sqlText)`(LEFT(${trimmedText}, 1) IN ('[', '{'))`;
  const jsonValid = (budget?.sql ?? sqlText)`pg_input_is_valid(${textSql}, 'jsonb')`;
  const coercedJson = (budget?.sql ?? sqlText)`(CASE
    WHEN ${baseExpr} IS NULL THEN '[]'::jsonb
    WHEN pg_typeof(${baseExpr}) = 'jsonb'::regtype THEN to_jsonb(${baseExpr})
    WHEN pg_typeof(${baseExpr}) = 'json'::regtype THEN to_jsonb(${baseExpr})
    WHEN pg_typeof(${baseExpr}) IN (${textTypes}) THEN
      CASE
        WHEN NULLIF(${trimmedText}, '') IS NULL THEN '[]'::jsonb
        WHEN ${looksJson} AND ${jsonValid} THEN (${textSql})::jsonb
        ELSE to_jsonb(${textSql})
      END
    ELSE to_jsonb(${baseExpr})
  END)`;
  return (budget?.sql ?? sqlText)`(CASE
    WHEN ${coercedJson} IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(${coercedJson}) = 'null' THEN '[]'::jsonb
    WHEN jsonb_typeof(${coercedJson}) = 'array' THEN ${coercedJson}
    ELSE jsonb_build_array(${coercedJson})
  END)`;
};

/**
 * Normalize an expression to a JSON array with a type validation strategy.
 * This version is compatible with both PG 16+ and earlier versions.
 *
 * Optimized to use a subquery to cache the intermediate coerced JSON value,
 * avoiding repeated evaluation of the type conversion logic.
 */
export const normalizeToJsonArrayWithStrategy = (
  expr: string,
  typeValidation: IPgTypeValidationStrategy,
  budget?: FormulaCompileBudget
): string => {
  const baseExpr = (budget?.sql ?? sqlText)`(${expr})`;
  const textTypes = joinSqlText(SQL_TEXT_TYPES, ', ', budget);
  const textSql = (budget?.sql ?? sqlText)`(${baseExpr})::text`;
  const trimmedText = (budget?.sql ?? sqlText)`BTRIM(${textSql})`;
  const looksJson = (budget?.sql ?? sqlText)`(LEFT(${trimmedText}, 1) IN ('[', '{'))`;
  const jsonValid = typeValidation.isValidForType(textSql, 'jsonb', budget);
  // Compute coercedJson once
  const coercedJson = (budget?.sql ?? sqlText)`(CASE
    WHEN ${baseExpr} IS NULL THEN '[]'::jsonb
    WHEN pg_typeof(${baseExpr}) = 'jsonb'::regtype THEN to_jsonb(${baseExpr})
    WHEN pg_typeof(${baseExpr}) = 'json'::regtype THEN to_jsonb(${baseExpr})
    WHEN pg_typeof(${baseExpr}) IN (${textTypes}) THEN
      CASE
        WHEN NULLIF(${trimmedText}, '') IS NULL THEN '[]'::jsonb
        WHEN ${looksJson} AND ${jsonValid} THEN (${textSql})::jsonb
        ELSE to_jsonb(${textSql})
      END
    ELSE to_jsonb(${baseExpr})
  END)`;
  // Use subquery to cache coercedJson, then reference the alias
  return (budget?.sql ?? sqlText)`(SELECT CASE
    WHEN _cj.v IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(_cj.v) = 'null' THEN '[]'::jsonb
    WHEN jsonb_typeof(_cj.v) = 'array' THEN _cj.v
    ELSE jsonb_build_array(_cj.v)
  END FROM (SELECT ${coercedJson} AS v) AS _cj)`;
};

export const extractJsonScalarText = (elemRef: string, budget?: FormulaCompileBudget): string =>
  (budget?.sql ?? sqlText)`(CASE
    WHEN jsonb_typeof(${elemRef}) = 'object' THEN COALESCE(${elemRef}->>'title', ${elemRef}->>'name', ${elemRef} #>> '{}')
    WHEN jsonb_typeof(${elemRef}) = 'array' THEN NULL
    ELSE ${elemRef} #>> '{}'
  END)`;

/**
 * @deprecated Use `extractFirstJsonScalarTextWithStrategy` instead for PG version compatibility.
 * This function uses `normalizeToJsonArray` which relies on `pg_input_is_valid` (PG 16+).
 */
export const extractFirstJsonScalarText = (expr: string, budget?: FormulaCompileBudget): string => {
  const normalizedJson = normalizeToJsonArray(expr, budget);
  return (budget?.sql ?? sqlText)`(SELECT CASE
    WHEN v.elem IS NULL OR jsonb_typeof(v.elem) = 'null' THEN NULL
    ELSE ${extractJsonScalarText('v.elem', budget)}
  END
  FROM (SELECT (${normalizedJson} -> 0) AS elem) AS v)`;
};

export const extractFirstJsonScalarTextWithStrategy = (
  expr: string,
  typeValidation: IPgTypeValidationStrategy,
  budget?: FormulaCompileBudget
): string => {
  const normalizedJson = normalizeToJsonArrayWithStrategy(expr, typeValidation, budget);
  return (budget?.sql ?? sqlText)`(SELECT CASE
    WHEN v.elem IS NULL OR jsonb_typeof(v.elem) = 'null' THEN NULL
    ELSE ${extractJsonScalarText('v.elem', budget)}
  END
  FROM (SELECT (${normalizedJson} -> 0) AS elem) AS v)`;
};

export const stringifyNormalizedJsonArray = (
  normalizedJson: string,
  separator = ', ',
  budget?: FormulaCompileBudget
): string => {
  const sepLiteral = sqlStringLiteral(separator, budget);
  return (budget?.sql ?? sqlText)`(
    SELECT string_agg(${extractJsonScalarText('elem', budget)}, ${sepLiteral} ORDER BY ord)
    FROM jsonb_array_elements(${normalizedJson}) WITH ORDINALITY AS _jae(elem, ord)
  )`;
};

/**
 * @deprecated Use `stringifyJsonArrayWithStrategy` instead for PG version compatibility.
 * This function uses `normalizeToJsonArray` which relies on `pg_input_is_valid` (PG 16+).
 */
export const stringifyJsonArray = (
  expr: string,
  separator = ', ',
  budget?: FormulaCompileBudget
): string => stringifyNormalizedJsonArray(normalizeToJsonArray(expr, budget), separator, budget);

export const stringifyJsonArrayWithStrategy = (
  expr: string,
  typeValidation: IPgTypeValidationStrategy,
  separator = ', ',
  budget?: FormulaCompileBudget
): string =>
  stringifyNormalizedJsonArray(
    normalizeToJsonArrayWithStrategy(expr, typeValidation, budget),
    separator,
    budget
  );
