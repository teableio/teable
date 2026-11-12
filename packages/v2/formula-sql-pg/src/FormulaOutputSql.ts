import { CellValueType, FieldType, type CellValueMultiplicity } from '@teable/v2-core';

import type { FormulaCompileBudget } from './FormulaCompileBudget';
import { extractJsonScalarText, normalizeToJsonArrayWithStrategy } from './PgSqlHelpers';
import type { IPgTypeValidationStrategy } from './PgTypeValidationStrategy';
import { guardFormulaValueSql, type SqlExpr, type SqlValueType } from './SqlExpression';

const extractFirstKnownJsonScalarText = (
  valueSql: string,
  budget: FormulaCompileBudget
): string => {
  const normalizedJson = budget.sql`(SELECT CASE
    WHEN _arr.v IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(_arr.v) = 'null' THEN '[]'::jsonb
    WHEN jsonb_typeof(_arr.v) = 'array' THEN _arr.v
    ELSE jsonb_build_array(_arr.v)
  END
  FROM (
    SELECT CASE
      WHEN (${valueSql}) IS NULL THEN NULL::jsonb
      ELSE (${valueSql})::jsonb
    END AS v
  ) AS _arr)`;
  return budget.sql`(SELECT CASE
    WHEN _elem.v IS NULL OR jsonb_typeof(_elem.v) = 'null' THEN NULL
    ELSE ${extractJsonScalarText('_elem.v', budget)}
  END
  FROM (SELECT (${normalizedJson} -> 0) AS v) AS _elem)`;
};

const castScalar = (
  text: string,
  valueType: SqlValueType,
  budget: FormulaCompileBudget
): string => {
  switch (valueType) {
    case 'number':
      return budget.sql`NULLIF(${text}, '')::double precision`;
    case 'boolean':
      return budget.sql`(${text})::boolean`;
    case 'datetime':
      return budget.sql`(${text})::timestamptz`;
    default:
      return text;
  }
};

const extractsJsonDisplay = (expr: SqlExpr): boolean => {
  const type = expr.field?.type();
  return Boolean(
    type &&
    (type.equals(FieldType.link()) ||
      type.equals(FieldType.button()) ||
      type.equals(FieldType.user()))
  );
};

const finalizeStoredValue = (
  expr: SqlExpr,
  multiple: boolean,
  strategy: IPgTypeValidationStrategy,
  budget: FormulaCompileBudget
): string => {
  if (expr.storageKind === 'json' && extractsJsonDisplay(expr)) {
    if (multiple) {
      const normalized = normalizeToJsonArrayWithStrategy(expr.valueSql, strategy, budget);
      return budget.sql`(
        SELECT jsonb_agg(to_jsonb(${extractJsonScalarText('elem', budget)}) ORDER BY ord)
        FROM jsonb_array_elements(${normalized}) WITH ORDINALITY AS _jae(elem, ord)
      )`;
    }
    if (expr.isArray) {
      return castScalar(
        extractFirstKnownJsonScalarText(expr.valueSql, budget),
        expr.valueType,
        budget
      );
    }
    return extractJsonScalarText(budget.sql`(${expr.valueSql})::jsonb`, budget);
  }
  if (expr.isArray && !multiple) {
    return castScalar(
      extractFirstKnownJsonScalarText(expr.valueSql, budget),
      expr.valueType,
      budget
    );
  }
  if (expr.storageKind === 'json' && !multiple) {
    return castScalar(
      extractJsonScalarText(budget.sql`(${expr.valueSql})::jsonb`, budget),
      expr.valueType,
      budget
    );
  }
  return expr.valueSql;
};

/** Stored and transient formula outputs share the same physical SQL representation. */
export const finalizeFormulaOutputSql = (
  expr: SqlExpr,
  output: { readonly valueType: CellValueType; readonly multiplicity: CellValueMultiplicity },
  strategy: IPgTypeValidationStrategy,
  budget: FormulaCompileBudget
): string => {
  const multiple = output.multiplicity.isMultiple();
  let value = finalizeStoredValue(expr, multiple, strategy, budget);
  if (!multiple && output.valueType.equals(CellValueType.number())) {
    value = budget.sql`NULLIF(BTRIM((${value})::text), '')::double precision`;
  } else if (!multiple && output.valueType.equals(CellValueType.string())) {
    // Core may infer String for mixed IF branches even when SQL lowering chose
    // a numeric/boolean/datetime domain. Mirror the persisted TEXT assignment,
    // so both returned values and alias ordering use the stored representation.
    value = budget.sql`(${value})::text`;
  } else if (!multiple && output.valueType.equals(CellValueType.dateTime())) {
    // Match the persisted DATETIME assignment before the driver sees a naive
    // timestamp (for example WORKDAY), rather than letting process TZ parse it.
    value = budget.sql`(${value})::timestamptz`;
  }
  return guardFormulaValueSql(
    value,
    expr,
    !multiple && output.valueType.equals(CellValueType.string()),
    budget
  );
};
