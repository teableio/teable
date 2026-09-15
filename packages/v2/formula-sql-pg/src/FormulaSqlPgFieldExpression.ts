import { ConditionalLookupField, FieldType, LookupField, type Field } from '@teable/v2-core';

import { makeExpr, type SqlExpr } from './SqlExpression';

const buildJsonObjectText = (ref: string): string =>
  `COALESCE(${ref}->>'title', ${ref}->>'name', ${ref} #>> '{}')`;

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

const normalizeJsonArraySql = (expr: SqlExpr): string => {
  const baseJson =
    expr.storageKind === 'array' ? `to_jsonb(${expr.valueSql})` : `(${expr.valueSql})::jsonb`;
  return `(CASE
    WHEN ${expr.valueSql} IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(${baseJson}) = 'array' THEN ${baseJson}
    WHEN jsonb_typeof(${baseJson}) = 'null' THEN '[]'::jsonb
    ELSE jsonb_build_array(${baseJson})
  END)`;
};

const normalizeLookupLinkTitles = (expr: SqlExpr): SqlExpr => {
  if (expr.isArray) {
    const normalizedArray = normalizeJsonArraySql(expr);
    return makeExpr(
      `COALESCE((SELECT jsonb_agg(${buildJsonObjectText('elem')}) FROM jsonb_array_elements(${normalizedArray}) AS arr(elem)), '[]'::jsonb)`,
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
    expr.storageKind === 'json' ? `(${expr.valueSql})::jsonb` : `to_jsonb(${expr.valueSql})`;
  const titleSql =
    expr.storageKind === 'json'
      ? buildJsonObjectText(jsonbValue)
      : `(SELECT ${buildJsonObjectText('j')} FROM (SELECT ${jsonbValue} AS j) s)`;
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

export const normalizeFormulaFieldExpression = (expr: SqlExpr): SqlExpr => {
  const innerField = expr.field ? resolveLookupInnerField(expr.field) : null;

  if (innerField?.type().equals(FieldType.link())) {
    return normalizeLookupLinkTitles(expr);
  }

  if (
    expr.storageKind === 'json' &&
    expr.isArray &&
    expr.field?.type().equals(FieldType.attachment())
  ) {
    const normalizedArray = normalizeJsonArraySql(expr);
    return {
      ...expr,
      displayValueSql: `(
      SELECT string_agg(${buildJsonObjectText('elem')}, ', ' ORDER BY ord)
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
      const jsonbValue = `(${expr.valueSql})::jsonb`;
      const valueSql = `COALESCE(${jsonbValue}->>'title', ${jsonbValue}->>'name', ${jsonbValue} #>> '{}')`;
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
