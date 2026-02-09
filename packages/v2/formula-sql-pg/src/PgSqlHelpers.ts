import type { IPgTypeValidationStrategy } from './PgTypeValidationStrategy';

export type ErrorCode = 'PARSE' | 'REF' | 'TYPE' | 'DIV0' | 'ARG' | 'NOT_IMPL' | 'INTERNAL';

const SQL_TEXT_TYPES = [
  "'text'",
  "'varchar'",
  "'bpchar'",
  "'character varying'",
  "'unknown'",
] as const;

export const escapeSqlLiteral = (value: string): string => value.replace(/'/g, "''");

export const sqlStringLiteral = (value: string): string => `'${escapeSqlLiteral(value)}'`;

export const buildErrorLiteral = (code: ErrorCode, reason: string): string =>
  sqlStringLiteral(`#ERROR:${code}:${reason}`);

export const safeJsonb = (expr: string): string => {
  const baseExpr = `(${expr})`;
  const textSql = `(${baseExpr})::text`;
  const trimmedText = `BTRIM(${textSql})`;
  return `(CASE
    WHEN ${baseExpr} IS NULL THEN NULL
    WHEN pg_typeof(${baseExpr}) = 'jsonb'::regtype THEN (${baseExpr})::jsonb
    WHEN pg_typeof(${baseExpr}) = 'json'::regtype THEN (${baseExpr})::jsonb
    WHEN NULLIF(${trimmedText}, '') IS NULL THEN NULL
    ELSE to_jsonb(${baseExpr})
  END)`;
};

export const safeJsonbWithStrategy = (
  expr: string,
  typeValidation: IPgTypeValidationStrategy
): string => {
  const baseExpr = `(${expr})`;
  const textTypes = SQL_TEXT_TYPES.join(', ');
  const textSql = `(${baseExpr})::text`;
  const trimmedText = `BTRIM(${textSql})`;
  const looksJson = `(LEFT(${trimmedText}, 1) IN ('[', '{'))`;
  const jsonValid = typeValidation.isValidForType(textSql, 'jsonb');
  return `(CASE
    WHEN ${baseExpr} IS NULL THEN NULL
    WHEN pg_typeof(${baseExpr}) = 'jsonb'::regtype THEN (${baseExpr})::jsonb
    WHEN pg_typeof(${baseExpr}) = 'json'::regtype THEN (${baseExpr})::jsonb
    WHEN pg_typeof(${baseExpr}) IN (${textTypes}) THEN
      CASE
        WHEN NULLIF(${trimmedText}, '') IS NULL THEN NULL
        WHEN ${looksJson} AND ${jsonValid} THEN (${textSql})::jsonb
        ELSE to_jsonb(${baseExpr})
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
export const normalizeToJsonArray = (expr: string): string => {
  const baseExpr = `(${expr})`;
  const textTypes = SQL_TEXT_TYPES.join(', ');
  const textSql = `(${baseExpr})::text`;
  const trimmedText = `BTRIM(${textSql})`;
  const looksJson = `(LEFT(${trimmedText}, 1) IN ('[', '{'))`;
  const jsonValid = `pg_input_is_valid(${textSql}, 'jsonb')`;
  const coercedJson = `(CASE
    WHEN ${baseExpr} IS NULL THEN '[]'::jsonb
    WHEN pg_typeof(${baseExpr}) = 'jsonb'::regtype THEN to_jsonb(${baseExpr})
    WHEN pg_typeof(${baseExpr}) = 'json'::regtype THEN to_jsonb(${baseExpr})
    WHEN pg_typeof(${baseExpr}) IN (${textTypes}) THEN
      CASE
        WHEN NULLIF(${trimmedText}, '') IS NULL THEN '[]'::jsonb
        WHEN ${looksJson} AND ${jsonValid} THEN (${textSql})::jsonb
        ELSE to_jsonb(${baseExpr})
      END
    ELSE to_jsonb(${baseExpr})
  END)`;
  return `(CASE
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
  typeValidation: IPgTypeValidationStrategy
): string => {
  const baseExpr = `(${expr})`;
  const textTypes = SQL_TEXT_TYPES.join(', ');
  const textSql = `(${baseExpr})::text`;
  const trimmedText = `BTRIM(${textSql})`;
  const looksJson = `(LEFT(${trimmedText}, 1) IN ('[', '{'))`;
  const jsonValid = typeValidation.isValidForType(textSql, 'jsonb');
  // Compute coercedJson once
  const coercedJson = `(CASE
    WHEN ${baseExpr} IS NULL THEN '[]'::jsonb
    WHEN pg_typeof(${baseExpr}) = 'jsonb'::regtype THEN to_jsonb(${baseExpr})
    WHEN pg_typeof(${baseExpr}) = 'json'::regtype THEN to_jsonb(${baseExpr})
    WHEN pg_typeof(${baseExpr}) IN (${textTypes}) THEN
      CASE
        WHEN NULLIF(${trimmedText}, '') IS NULL THEN '[]'::jsonb
        WHEN ${looksJson} AND ${jsonValid} THEN (${textSql})::jsonb
        ELSE to_jsonb(${baseExpr})
      END
    ELSE to_jsonb(${baseExpr})
  END)`;
  // Use subquery to cache coercedJson, then reference the alias
  return `(SELECT CASE
    WHEN _cj.v IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(_cj.v) = 'null' THEN '[]'::jsonb
    WHEN jsonb_typeof(_cj.v) = 'array' THEN _cj.v
    ELSE jsonb_build_array(_cj.v)
  END FROM (SELECT ${coercedJson} AS v) AS _cj)`;
};

export const extractJsonScalarText = (elemRef: string): string =>
  `(CASE
    WHEN jsonb_typeof(${elemRef}) = 'object' THEN COALESCE(${elemRef}->>'title', ${elemRef}->>'name', ${elemRef} #>> '{}')
    WHEN jsonb_typeof(${elemRef}) = 'array' THEN NULL
    ELSE ${elemRef} #>> '{}'
  END)`;

/**
 * @deprecated Use `extractFirstJsonScalarTextWithStrategy` instead for PG version compatibility.
 * This function uses `normalizeToJsonArray` which relies on `pg_input_is_valid` (PG 16+).
 */
export const extractFirstJsonScalarText = (expr: string): string => {
  const normalizedJson = normalizeToJsonArray(expr);
  return `(SELECT CASE
    WHEN v.elem IS NULL OR jsonb_typeof(v.elem) = 'null' THEN NULL
    ELSE ${extractJsonScalarText('v.elem')}
  END
  FROM (SELECT (${normalizedJson} -> 0) AS elem) AS v)`;
};

export const extractFirstJsonScalarTextWithStrategy = (
  expr: string,
  typeValidation: IPgTypeValidationStrategy
): string => {
  const normalizedJson = normalizeToJsonArrayWithStrategy(expr, typeValidation);
  return `(SELECT CASE
    WHEN v.elem IS NULL OR jsonb_typeof(v.elem) = 'null' THEN NULL
    ELSE ${extractJsonScalarText('v.elem')}
  END
  FROM (SELECT (${normalizedJson} -> 0) AS elem) AS v)`;
};

export const stringifyNormalizedJsonArray = (normalizedJson: string, separator = ', '): string => {
  const sepLiteral = sqlStringLiteral(separator);
  return `(
    SELECT string_agg(${extractJsonScalarText('elem')}, ${sepLiteral} ORDER BY ord)
    FROM jsonb_array_elements(${normalizedJson}) WITH ORDINALITY AS _jae(elem, ord)
  )`;
};

/**
 * @deprecated Use `stringifyJsonArrayWithStrategy` instead for PG version compatibility.
 * This function uses `normalizeToJsonArray` which relies on `pg_input_is_valid` (PG 16+).
 */
export const stringifyJsonArray = (expr: string, separator = ', '): string =>
  stringifyNormalizedJsonArray(normalizeToJsonArray(expr), separator);

export const stringifyJsonArrayWithStrategy = (
  expr: string,
  typeValidation: IPgTypeValidationStrategy,
  separator = ', '
): string =>
  stringifyNormalizedJsonArray(normalizeToJsonArrayWithStrategy(expr, typeValidation), separator);
