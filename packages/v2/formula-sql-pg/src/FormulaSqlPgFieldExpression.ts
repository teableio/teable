import { ConditionalLookupField, FieldType, LookupField, type Field } from '@teable/v2-core';
import { sqlText, type FormulaCompileBudget } from './FormulaCompileBudget';

import { makeExpr, type SqlExpr } from './SqlExpression';

const buildJsonObjectText = (ref: string, budget?: FormulaCompileBudget): string =>
  (budget?.sql ?? sqlText)`COALESCE(${ref}->>'title', ${ref}->>'name', ${ref} #>> '{}')`;

const resolveLookupInnerField = (field: Field): Field | null => {
  if (field.type().equals(FieldType.lookup())) {
    const lookupField = field as LookupField;
    const innerFieldResult = lookupField.innerField();
    return innerFieldResult.isOk() ? innerFieldResult.value : null;
  }
  if (field.type().equals(FieldType.conditionalLookup())) {
    const conditionalLookupField = field as ConditionalLookupField;
    const innerFieldResult = conditionalLookupField.innerField();
    return innerFieldResult.isOk() ? innerFieldResult.value : null;
  }
  return null;
};

const normalizeJsonArraySql = (expr: SqlExpr, budget?: FormulaCompileBudget): string => {
  const baseJson =
    expr.storageKind === 'array'
      ? (budget?.sql ?? sqlText)`to_jsonb(${expr.valueSql})`
      : (budget?.sql ?? sqlText)`(${expr.valueSql})::jsonb`;
  return (budget?.sql ?? sqlText)`(CASE
    WHEN ${expr.valueSql} IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(${baseJson}) = 'array' THEN ${baseJson}
    WHEN jsonb_typeof(${baseJson}) = 'null' THEN '[]'::jsonb
    ELSE jsonb_build_array(${baseJson})
  END)`;
};

const normalizeLookupLinkTitles = (expr: SqlExpr, budget?: FormulaCompileBudget): SqlExpr => {
  if (expr.isArray) {
    const normalizedArray = normalizeJsonArraySql(expr, budget);
    return makeExpr(
      (budget?.sql ??
        sqlText)`COALESCE((SELECT jsonb_agg(${buildJsonObjectText('elem', budget)}) FROM jsonb_array_elements(${normalizedArray}) AS arr(elem)), '[]'::jsonb)`,
      'string',
      true,
      expr.errorConditionSql,
      expr.errorMessageSql,
      expr.field,
      'json'
    );
  }

  // Leftover TEXT lookup-of-link titles are marked scalar. Use to_jsonb()
  // once instead of ::jsonb so 'Peer A' stays a JSON string, not invalid json.
  const jsonbValue =
    expr.storageKind === 'json'
      ? (budget?.sql ?? sqlText)`(${expr.valueSql})::jsonb`
      : (budget?.sql ?? sqlText)`to_jsonb(${expr.valueSql})`;
  const titleSql =
    expr.storageKind === 'json'
      ? buildJsonObjectText(jsonbValue, budget)
      : (budget?.sql ??
          sqlText)`(SELECT ${buildJsonObjectText('j', budget)} FROM (SELECT ${jsonbValue} AS j) s)`;
  return makeExpr(
    titleSql,
    'string',
    false,
    expr.errorConditionSql,
    expr.errorMessageSql,
    expr.field,
    'scalar'
  );
};

export const normalizeFormulaFieldExpression = (
  expr: SqlExpr,
  budget?: FormulaCompileBudget
): SqlExpr => {
  const innerField = expr.field ? resolveLookupInnerField(expr.field) : null;

  if (innerField?.type().equals(FieldType.link())) {
    return normalizeLookupLinkTitles(expr, budget);
  }

  if (
    expr.storageKind === 'json' &&
    expr.isArray &&
    expr.field?.type().equals(FieldType.attachment())
  ) {
    const normalizedArray = normalizeJsonArraySql(expr, budget);
    return {
      ...expr,
      displayValueSql: (budget?.sql ?? sqlText)`(
      SELECT string_agg(${buildJsonObjectText('elem', budget)}, ', ' ORDER BY ord)
      FROM jsonb_array_elements(${normalizedArray}) WITH ORDINALITY AS arr(elem, ord)
    )`,
    };
  }

  // For JSON object fields (button, link), extract the display value (title/name)
  // when directly referenced in a formula. This ensures that {Button} and {LinkField}
  // return the human-readable title instead of the raw JSON object.
  if (expr.storageKind === 'json' && !expr.isArray && expr.field) {
    const fieldType = expr.field.type();
    if (fieldType.equals(FieldType.button()) || fieldType.equals(FieldType.link())) {
      const jsonbValue = (budget?.sql ?? sqlText)`(${expr.valueSql})::jsonb`;
      const valueSql = (budget?.sql ??
        sqlText)`COALESCE(${jsonbValue}->>'title', ${jsonbValue}->>'name', ${jsonbValue} #>> '{}')`;
      return makeExpr(
        valueSql,
        'string',
        false,
        expr.errorConditionSql,
        expr.errorMessageSql,
        expr.field,
        'scalar'
      );
    }
  }

  return expr;
};
