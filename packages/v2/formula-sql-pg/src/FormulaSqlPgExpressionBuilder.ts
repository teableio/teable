/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable sonarjs/no-duplicate-string */
import {
  DateTimeFormatting,
  FieldType,
  TimeFormatting,
  type ConditionalLookupField,
  type LookupField,
  type Field,
} from '@teable/v2-core';

import { formatFieldValueAsStringSql } from './FieldFormattingSql';
import { buildFieldSqlMetadata } from './FieldSqlCoercionVisitor';

import type { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import {
  buildErrorLiteral,
  extractFirstJsonScalarTextWithStrategy,
  extractJsonScalarText,
  normalizeToJsonArrayWithStrategy,
  safeJsonbWithStrategy,
  sqlStringLiteral,
  stringifyNormalizedJsonArray,
} from './PgSqlHelpers';
import type { IPgTypeValidationStrategy } from './PgTypeValidationStrategy';
import {
  buildErrorMessageSql,
  combineErrorConditions,
  guardValueSql,
  makeExpr,
  type SqlExpr,
  type SqlValueType,
} from './SqlExpression';
import { mapTimeZoneToPg } from './TimeZonePgMapping';

type DateAddUnit = 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';
type DatetimeDiffUnit =
  | 'millisecond'
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year';
type IsSameUnit = 'year' | 'month' | 'day';

export const DATE_ADD_UNIT_ALIASES: Record<string, DateAddUnit> = {
  year: 'year',
  years: 'year',
  quarter: 'quarter',
  quarters: 'quarter',
  month: 'month',
  months: 'month',
  week: 'week',
  weeks: 'week',
  day: 'day',
  days: 'day',
  hour: 'hour',
  hours: 'hour',
  minute: 'minute',
  minutes: 'minute',
  second: 'second',
  seconds: 'second',
};

export const DATETIME_DIFF_UNIT_ALIASES: Record<string, DatetimeDiffUnit> = {
  millisecond: 'millisecond',
  milliseconds: 'millisecond',
  second: 'second',
  seconds: 'second',
  minute: 'minute',
  minutes: 'minute',
  hour: 'hour',
  hours: 'hour',
  day: 'day',
  days: 'day',
  week: 'week',
  weeks: 'week',
  month: 'month',
  months: 'month',
  quarter: 'quarter',
  quarters: 'quarter',
  year: 'year',
  years: 'year',
};

export const IS_SAME_UNIT_ALIASES: Record<string, IsSameUnit> = {
  year: 'year',
  years: 'year',
  month: 'month',
  months: 'month',
  day: 'day',
  days: 'day',
};

const JSON_OBJECT_FIELD_TYPES = new Set(['button', 'link']);
const JSON_ARRAY_OBJECT_FIELD_TYPES = new Set(['user', 'attachment']);
const JSON_ARRAY_SCALAR_FIELD_TYPES = new Set(['multipleSelect']);
const SCALAR_STRING_FIELD_TYPES = new Set([
  'singleLineText',
  'longText',
  'singleSelect',
  'createdBy',
  'lastModifiedBy',
  'formula',
]);
const NON_DATETIME_FIELD_TYPES = new Set([
  'singleSelect',
  'multipleSelect',
  'createdBy',
  'lastModifiedBy',
  'user',
  'attachment',
  'button',
  'link',
]);

const DATE_ADD_INTERVALS: Record<DateAddUnit, string> = {
  year: "INTERVAL '1 year'",
  quarter: "INTERVAL '3 month'",
  month: "INTERVAL '1 month'",
  week: "INTERVAL '1 week'",
  day: "INTERVAL '1 day'",
  hour: "INTERVAL '1 hour'",
  minute: "INTERVAL '1 minute'",
  second: "INTERVAL '1 second'",
};

export const DATE_ADD_UNIT_SQL = Object.keys(DATE_ADD_UNIT_ALIASES)
  .map((unit) => `'${unit}'`)
  .join(', ');
export const DATETIME_DIFF_UNIT_SQL = Object.keys(DATETIME_DIFF_UNIT_ALIASES)
  .map((unit) => `'${unit}'`)
  .join(', ');
export const IS_SAME_UNIT_SQL = Object.keys(IS_SAME_UNIT_ALIASES)
  .map((unit) => `'${unit}'`)
  .join(', ');

export class FormulaSqlPgExpressionBuilder {
  protected readonly typeValidation: IPgTypeValidationStrategy;

  constructor(protected readonly translator: FormulaSqlPgTranslator) {
    this.typeValidation = translator.typeValidationStrategy;
  }

  protected formulaTimeZone(): string {
    return this.translator.timeZone ?? 'utc';
  }

  protected formulaTimeZoneSql(): string {
    return sqlStringLiteral(mapTimeZoneToPg(this.formulaTimeZone()));
  }

  protected applyFormulaTimeZone(valueSql: string): string {
    return `(${valueSql}) AT TIME ZONE ${this.formulaTimeZoneSql()}`;
  }

  protected interpretTimestampInFormulaTimeZone(valueSql: string): string {
    return `(${valueSql})::timestamp AT TIME ZONE ${this.formulaTimeZoneSql()}`;
  }

  public applyUnaryOp(kind: 'minus' | 'not', operand: SqlExpr): SqlExpr {
    if (kind === 'minus') {
      const numeric = this.coerceToNumber(operand, 'unary_minus');
      const errorCondition = numeric.errorConditionSql;
      const valueSql = guardValueSql(`(-(${numeric.valueSql}))`, errorCondition);
      return makeExpr(
        valueSql,
        'number',
        false,
        errorCondition,
        numeric.errorMessageSql,
        numeric.field
      );
    }
    if (kind === 'not') {
      const boolExpr = this.coerceToBoolean(operand);
      const valueSql = guardValueSql(`(NOT ${boolExpr.valueSql})`, boolExpr.errorConditionSql);
      return makeExpr(
        valueSql,
        'boolean',
        false,
        boolExpr.errorConditionSql,
        boolExpr.errorMessageSql,
        boolExpr.field
      );
    }
    return makeExpr('NULL', 'unknown', false, 'TRUE', buildErrorLiteral('INTERNAL', 'unexpected'));
  }

  public applyBinaryOp(operator: string, left: SqlExpr, right: SqlExpr): SqlExpr {
    switch (operator) {
      case '+':
        return this.handlePlus(left, right);
      case '-':
        return this.handleMinus(left, right);
      case '*':
        return this.handleNumericOp('*', left, right, 'multiply');
      case '/':
        return this.handleDivision(left, right);
      case '%':
        return this.handleModulo(left, right);
      case '=':
        return this.handleComparison('=', left, right);
      case '<>':
        return this.handleComparison('<>', left, right);
      case '>':
        return this.handleComparison('>', left, right);
      case '>=':
        return this.handleComparison('>=', left, right);
      case '<':
        return this.handleComparison('<', left, right);
      case '<=':
        return this.handleComparison('<=', left, right);
      case 'OR':
        return this.handleLogicalOp('OR', left, right);
      case 'AND':
        return this.handleLogicalOp('AND', left, right);
      case '&':
        return this.handleStringConcat(left, right);
      default:
        return makeExpr(
          'NULL',
          'unknown',
          false,
          'TRUE',
          buildErrorLiteral('INTERNAL', 'unexpected')
        );
    }
  }
  protected handlePlus(left: SqlExpr, right: SqlExpr): SqlExpr {
    const leftScalar = this.unwrapArrayToScalar(left);
    const rightScalar = this.unwrapArrayToScalar(right);

    // Handle date + number = date (add days)
    if (leftScalar.valueType === 'datetime' && rightScalar.valueType === 'number') {
      return this.handleDatePlusDays(leftScalar, rightScalar);
    }
    if (leftScalar.valueType === 'number' && rightScalar.valueType === 'datetime') {
      return this.handleDatePlusDays(rightScalar, leftScalar);
    }

    if (leftScalar.valueType === 'number' && rightScalar.valueType === 'number') {
      return this.handleNumericOp('+', leftScalar, rightScalar, 'add');
    }

    return this.handleStringConcat(leftScalar, rightScalar);
  }

  protected handleMinus(left: SqlExpr, right: SqlExpr): SqlExpr {
    const leftScalar = this.unwrapArrayToScalar(left);
    const rightScalar = this.unwrapArrayToScalar(right);

    // Handle date - number = date (subtract days)
    if (leftScalar.valueType === 'datetime' && rightScalar.valueType === 'number') {
      return this.handleDateMinusDays(leftScalar, rightScalar);
    }

    // Handle date - date = number (difference in days)
    if (leftScalar.valueType === 'datetime' && rightScalar.valueType === 'datetime') {
      return this.handleDateDiff(leftScalar, rightScalar);
    }

    return this.handleNumericOp('-', leftScalar, rightScalar, 'subtract');
  }

  protected handleDatePlusDays(dateExpr: SqlExpr, daysExpr: SqlExpr): SqlExpr {
    const dateDt = this.coerceToDatetime(dateExpr);
    const daysNum = this.coerceToNumber(daysExpr, 'date_arithmetic');

    const errorCondition = combineErrorConditions([dateDt, daysNum]);
    const errorMessage = buildErrorMessageSql(
      [dateDt, daysNum],
      buildErrorLiteral('TYPE', 'invalid_date_arithmetic')
    );

    const valueSql = guardValueSql(
      `(${dateDt.valueSql} + (${daysNum.valueSql}) * INTERVAL '1 day')`,
      errorCondition
    );
    return makeExpr(valueSql, 'datetime', false, errorCondition, errorMessage);
  }

  protected handleDateMinusDays(dateExpr: SqlExpr, daysExpr: SqlExpr): SqlExpr {
    const dateDt = this.coerceToDatetime(dateExpr);
    const daysNum = this.coerceToNumber(daysExpr, 'date_arithmetic');

    const errorCondition = combineErrorConditions([dateDt, daysNum]);
    const errorMessage = buildErrorMessageSql(
      [dateDt, daysNum],
      buildErrorLiteral('TYPE', 'invalid_date_arithmetic')
    );

    const valueSql = guardValueSql(
      `(${dateDt.valueSql} - (${daysNum.valueSql}) * INTERVAL '1 day')`,
      errorCondition
    );
    return makeExpr(valueSql, 'datetime', false, errorCondition, errorMessage);
  }

  protected handleDateDiff(leftDate: SqlExpr, rightDate: SqlExpr): SqlExpr {
    const leftDt = this.coerceToDatetime(leftDate);
    const rightDt = this.coerceToDatetime(rightDate);
    const errorCondition = combineErrorConditions([leftDt, rightDt]);
    const errorMessage = buildErrorMessageSql(
      [leftDt, rightDt],
      buildErrorLiteral('TYPE', 'invalid_date_arithmetic')
    );

    // Return difference in days
    const valueSql = guardValueSql(
      `(EXTRACT(EPOCH FROM ${leftDt.valueSql} - ${rightDt.valueSql}) / 86400)`,
      errorCondition
    );
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  protected handleNumericOp(
    operator: string,
    left: SqlExpr,
    right: SqlExpr,
    reason: string
  ): SqlExpr {
    const leftNumber = this.coerceToNumber(left, reason);
    const rightNumber = this.coerceToNumber(right, reason);
    const errorCondition = combineErrorConditions([leftNumber, rightNumber]);
    const errorMessage = buildErrorMessageSql(
      [leftNumber, rightNumber],
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );

    const leftValue = `COALESCE(${leftNumber.valueSql}, 0)`;
    const rightValue = `COALESCE(${rightNumber.valueSql}, 0)`;
    const valueSql = guardValueSql(`(${leftValue} ${operator} ${rightValue})`, errorCondition);
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  protected handleDivision(left: SqlExpr, right: SqlExpr): SqlExpr {
    const leftNumber = this.coerceToNumber(left, 'divide');
    const rightNumber = this.coerceToNumber(right, 'divide');

    const divZeroCondition = `(${rightNumber.valueSql}) = 0`;
    const errorCondition = combineErrorConditions([
      leftNumber,
      rightNumber,
      makeExpr(
        'NULL',
        'number',
        false,
        divZeroCondition,
        buildErrorLiteral('DIV0', 'division_by_zero')
      ),
    ]);
    const errorMessage = buildErrorMessageSql(
      [
        leftNumber,
        rightNumber,
        makeExpr(
          'NULL',
          'number',
          false,
          divZeroCondition,
          buildErrorLiteral('DIV0', 'division_by_zero')
        ),
      ],
      buildErrorLiteral('DIV0', 'division_by_zero')
    );
    const numerator = `COALESCE(${leftNumber.valueSql}, 0)`;
    const valueSql = guardValueSql(`(${numerator} / ${rightNumber.valueSql})`, errorCondition);
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  protected handleModulo(left: SqlExpr, right: SqlExpr): SqlExpr {
    const leftNumber = this.coerceToNumber(left, 'modulo');
    const rightNumber = this.coerceToNumber(right, 'modulo');
    const errorCondition = combineErrorConditions([leftNumber, rightNumber]);
    const errorMessage = buildErrorMessageSql(
      [leftNumber, rightNumber],
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );

    const dividend = `COALESCE(${leftNumber.valueSql}, 0)`;
    const divisor = rightNumber.valueSql;
    const valueSql = guardValueSql(
      `(CASE WHEN ${divisor} IS NULL OR ${divisor} = 0 THEN NULL ELSE MOD((${dividend})::numeric, (${divisor})::numeric)::double precision END)`,
      errorCondition
    );
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  protected handleStringConcat(left: SqlExpr, right: SqlExpr): SqlExpr {
    const leftText = this.coerceToStringForConcat(left);
    const rightText = this.coerceToStringForConcat(right);
    const errorCondition = combineErrorConditions([leftText, rightText]);
    const errorMessage = buildErrorMessageSql(
      [leftText, rightText],
      buildErrorLiteral('TYPE', 'cannot_cast_to_text')
    );
    const emptyText = sqlStringLiteral('');
    const leftValue = `COALESCE(${leftText.valueSql}, ${emptyText})`;
    const rightValue = `COALESCE(${rightText.valueSql}, ${emptyText})`;
    const valueSql = guardValueSql(`(${leftValue} || ${rightValue})`, errorCondition);
    return makeExpr(valueSql, 'string', false, errorCondition, errorMessage);
  }

  protected coerceToStringForConcat(expr: SqlExpr): SqlExpr {
    if (expr.isArray) {
      return this.coerceToString(expr, false);
    }
    const treatAsDatetime = expr.valueType === 'datetime' || this.isDatetimeField(expr);
    if (!treatAsDatetime) {
      return this.coerceToString(expr, false);
    }
    return this.coerceDatetimeToStringForConcat(expr);
  }

  protected coerceDatetimeToStringForConcat(expr: SqlExpr): SqlExpr {
    const formatting = this.resolveDateTimeFormatting(expr.field);
    const hasTime = formatting ? formatting.time() !== TimeFormatting.None : false;
    const timeZone = this.formulaTimeZone();
    const formattedSql = hasTime
      ? formatFieldValueAsStringSql(expr.field, expr.valueSql, 'datetime', timeZone)
      : undefined;
    const fallbackSql = formattedSql ?? this.formatDatetimeForConcat(expr.valueSql, timeZone);
    return makeExpr(
      fallbackSql,
      'string',
      false,
      expr.errorConditionSql,
      expr.errorMessageSql,
      expr.field,
      'scalar'
    );
  }

  protected formatDatetimeForConcat(valueSql: string, timeZone: string): string {
    const tzSql = sqlStringLiteral(mapTimeZoneToPg(timeZone));
    const maskSql = sqlStringLiteral('YYYY-MM-DD HH24:MI');
    return `TO_CHAR((${valueSql})::timestamptz AT TIME ZONE ${tzSql}, ${maskSql})`;
  }

  protected resolveDateTimeFormatting(field: Field | undefined): DateTimeFormatting | undefined {
    if (!field) return undefined;
    const formatting = (field as { formatting?: () => unknown }).formatting?.();
    if (formatting instanceof DateTimeFormatting) {
      return formatting;
    }
    const innerField = this.resolveLookupInnerFieldForFormatting(field);
    if (!innerField) return undefined;
    const innerFormatting = (innerField as { formatting?: () => unknown }).formatting?.();
    if (innerFormatting instanceof DateTimeFormatting) {
      return innerFormatting;
    }
    return undefined;
  }

  private resolveLookupInnerFieldForFormatting(field: Field): Field | null {
    if (field.type().equals(FieldType.lookup())) {
      const lookupField = field as LookupField;
      const innerFieldResult = lookupField.innerField();
      return innerFieldResult.isOk() ? innerFieldResult.value : null;
    }
    if (field.type().equals(FieldType.conditionalLookup())) {
      const conditionalField = field as ConditionalLookupField;
      const innerFieldResult = conditionalField.innerField();
      return innerFieldResult.isOk() ? innerFieldResult.value : null;
    }
    return null;
  }

  protected handleLogicalOp(operator: 'AND' | 'OR', left: SqlExpr, right: SqlExpr): SqlExpr {
    const leftBool = this.coerceToBoolean(left);
    const rightBool = this.coerceToBoolean(right);
    const errorCondition = combineErrorConditions([leftBool, rightBool]);
    const errorMessage = buildErrorMessageSql(
      [leftBool, rightBool],
      buildErrorLiteral('TYPE', 'cannot_cast_to_boolean')
    );
    const valueSql = guardValueSql(
      `(${leftBool.valueSql} ${operator} ${rightBool.valueSql})`,
      errorCondition
    );
    return makeExpr(valueSql, 'boolean', false, errorCondition, errorMessage);
  }

  protected handleComparison(operator: string, left: SqlExpr, right: SqlExpr): SqlExpr {
    if (left.isArray || right.isArray) {
      const leftScalar = this.unwrapArrayToScalar(left);
      const rightScalar = this.unwrapArrayToScalar(right);
      return this.handleComparison(operator, leftScalar, rightScalar);
    }

    const leftType = left.valueType;
    const rightType = right.valueType;
    const errorCondition = combineErrorConditions([left, right]);
    const errorMessage = buildErrorMessageSql(
      [left, right],
      buildErrorLiteral('TYPE', 'invalid_comparison')
    );

    // Handle boolean vs number comparison: coerce boolean to number (true=1, false=0)
    // This ensures {checkbox} = 1 works correctly (checkbox true -> 1, false -> 0)
    if (
      (leftType === 'boolean' && rightType === 'number') ||
      (leftType === 'number' && rightType === 'boolean')
    ) {
      const leftNum = this.coerceToNumber(left, 'comparison');
      const rightNum = this.coerceToNumber(right, 'comparison');
      const valueSql = guardValueSql(
        `(${leftNum.valueSql} ${operator} ${rightNum.valueSql})`,
        combineErrorConditions([leftNum, rightNum, left, right])
      );
      return makeExpr(valueSql, 'boolean', false, errorCondition, errorMessage);
    }

    if (leftType === 'number' || rightType === 'number') {
      const numericComparison = this.buildLooseNumericComparison(left, right, operator);
      const valueSql = guardValueSql(numericComparison, errorCondition);
      return makeExpr(valueSql, 'boolean', false, errorCondition, errorMessage);
    }

    if (leftType === 'datetime' || rightType === 'datetime') {
      const datetimeComparison = this.buildLooseDatetimeComparison(left, right, operator);
      const valueSql = guardValueSql(datetimeComparison, errorCondition);
      return makeExpr(valueSql, 'boolean', false, errorCondition, errorMessage);
    }

    const leftText = this.coerceToString(left, false);
    const rightText = this.coerceToString(right, false);
    const emptyText = sqlStringLiteral('');
    const leftValue = `COALESCE(${leftText.valueSql}, ${emptyText})`;
    const rightValue = `COALESCE(${rightText.valueSql}, ${emptyText})`;
    const valueSql = guardValueSql(
      `(${leftValue} ${operator} ${rightValue})`,
      combineErrorConditions([leftText, rightText, left, right])
    );
    return makeExpr(valueSql, 'boolean', false, errorCondition, errorMessage);
  }

  protected normalizeArrayExpr(expr: SqlExpr): string {
    // Optimize for lookup fields: they are always stored as JSON
    const innerFieldType = this.getLookupInnerFieldType(expr);
    if ((innerFieldType || this.isLookupArrayField(expr)) && expr.storageKind === 'array') {
      return this.normalizeLookupArrayExpr(expr);
    }

    // For known JSON storage array fields (attachment, user, multipleSelect, etc.),
    // check if this is a direct field reference (simple column access).
    // Direct references can use simplified cast; computed expressions need type validation.
    if (
      expr.storageKind === 'json' &&
      expr.isArray &&
      (this.isJsonArrayObjectField(expr) || this.isJsonArrayScalarField(expr))
    ) {
      // If valueSql is a simple column reference like "t"."ColName", use direct cast
      // These fields are stored as JSONB arrays in the database
      if (this.isDirectColumnReference(expr.valueSql)) {
        return `COALESCE(NULLIF((${expr.valueSql})::jsonb, 'null'::jsonb), '[]'::jsonb)`;
      }
      // For computed expressions, need full type validation
      return normalizeToJsonArrayWithStrategy(expr.valueSql, this.typeValidation);
    }
    const fieldType = this.getFieldTypeName(expr);
    if (
      expr.storageKind === 'scalar' &&
      expr.valueType !== 'string' &&
      expr.valueType !== 'unknown'
    ) {
      return `(CASE
        WHEN ${expr.valueSql} IS NULL THEN '[]'::jsonb
        ELSE jsonb_build_array(to_jsonb(${expr.valueSql}))
      END)`;
    }
    if (
      expr.storageKind === 'scalar' &&
      expr.valueType === 'string' &&
      !expr.isArray &&
      fieldType &&
      SCALAR_STRING_FIELD_TYPES.has(fieldType)
    ) {
      return `(CASE
        WHEN ${expr.valueSql} IS NULL THEN '[]'::jsonb
        ELSE jsonb_build_array(to_jsonb(${expr.valueSql}))
      END)`;
    }
    if (expr.storageKind === 'array' || expr.storageKind === 'json') {
      // For known JSON storage fields (attachment, user, etc.), use direct cast
      // safeJsonbWithStrategy is only needed for unknown/text columns
      const jsonValue =
        expr.storageKind === 'array' ? `to_jsonb(${expr.valueSql})` : `(${expr.valueSql})::jsonb`;
      return `(CASE
        WHEN ${expr.valueSql} IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(${jsonValue}) = 'array' THEN ${jsonValue}
        WHEN jsonb_typeof(${jsonValue}) = 'null' THEN '[]'::jsonb
        ELSE jsonb_build_array(${jsonValue})
      END)`;
    }
    return normalizeToJsonArrayWithStrategy(expr.valueSql, this.typeValidation);
  }

  protected extractArrayScalarText(expr: SqlExpr): string {
    if (expr.storageKind === 'array' || expr.storageKind === 'json') {
      const normalized = this.normalizeArrayExpr(expr);

      // For lookup fields, prefer innerField-aware extraction when available.
      if (this.isLookupArrayField(expr)) {
        const innerField = this.getLookupInnerField(expr);
        if (innerField) {
          if (innerField.type().equals(FieldType.formula())) {
            const metadataResult = buildFieldSqlMetadata(innerField);
            if (metadataResult.isOk()) {
              return this.extractProxiedLookupScalarText(
                normalized,
                metadataResult.value.valueType
              );
            }
          }
          return this.extractLookupScalarText(normalized, innerField.type().toString());
        }
        return this.extractProxiedLookupScalarText(normalized, expr.valueType);
      }

      if (this.isJsonArrayObjectField(expr)) {
        return this.buildFirstElementText(normalized, this.buildJsonObjectText('fe.elem'));
      }
      if (this.isJsonArrayScalarField(expr)) {
        return this.buildFirstElementText(normalized, "fe.elem #>> '{}'");
      }
      return `(SELECT CASE
        WHEN fe.elem IS NULL OR jsonb_typeof(fe.elem) = 'null' THEN NULL
        ELSE ${extractJsonScalarText('fe.elem')}
      END
      FROM (SELECT (${normalized} -> 0) AS elem) AS fe)`;
    }
    return extractFirstJsonScalarTextWithStrategy(expr.valueSql, this.typeValidation);
  }

  /**
   * Extract scalar text from a proxied lookup field based on its valueType.
   * The valueType comes from the innerField, so we can use it directly without
   * additional type checking.
   */
  private extractProxiedLookupScalarText(normalizedJson: string, valueType: string): string {
    // Use 'lkp' alias to avoid conflicts with 'v' used in withValueAlias
    switch (valueType) {
      case 'number':
        return `(SELECT CASE
          WHEN lkp.elem IS NULL OR jsonb_typeof(lkp.elem) = 'null' THEN NULL
          ELSE (lkp.elem #>> '{}')::numeric
        END
        FROM (SELECT (${normalizedJson} -> 0) AS elem) AS lkp)`;
      case 'boolean':
        return `(SELECT CASE
          WHEN lkp.elem IS NULL OR jsonb_typeof(lkp.elem) = 'null' THEN NULL
          WHEN (lkp.elem #>> '{}')::boolean THEN TRUE
          ELSE FALSE
        END
        FROM (SELECT (${normalizedJson} -> 0) AS elem) AS lkp)`;
      case 'datetime':
      case 'string':
        // For datetime, extract as text - the actual conversion happens in coerceToDatetime
        return `(SELECT CASE
          WHEN lkp.elem IS NULL OR jsonb_typeof(lkp.elem) = 'null' THEN NULL
          ELSE lkp.elem #>> '{}'
        END
        FROM (SELECT (${normalizedJson} -> 0) AS elem) AS lkp)`;
      default:
        // For unknown types, detect JSON type at runtime and extract appropriately
        // This handles cases where innerField is not yet resolved (pending lookup fields)
        return `(SELECT CASE
          WHEN lkp.elem IS NULL OR jsonb_typeof(lkp.elem) = 'null' THEN NULL
          WHEN jsonb_typeof(lkp.elem) = 'number' THEN (lkp.elem #>> '{}')::numeric::text
          WHEN jsonb_typeof(lkp.elem) = 'boolean' THEN (lkp.elem #>> '{}')
          ELSE lkp.elem #>> '{}'
        END
        FROM (SELECT (${normalizedJson} -> 0) AS elem) AS lkp)`;
    }
  }

  /**
   * Extract scalar text from a lookup field based on its innerField type.
   * This optimizes SQL generation by using type-specific extraction logic.
   */
  protected extractLookupScalarText(normalizedJson: string, innerFieldType: string): string {
    // Use 'lkp' alias to avoid conflicts with 'v' used in withValueAlias
    // Button, link, and attachment types cannot be converted to scalar values
    if (
      innerFieldType === 'button' ||
      innerFieldType === 'link' ||
      innerFieldType === 'attachment'
    ) {
      return `(SELECT NULL FROM (SELECT (${normalizedJson} -> 0) AS elem) AS lkp)`;
    }

    // Number types: extract as numeric
    if (
      innerFieldType === 'number' ||
      innerFieldType === 'rating' ||
      innerFieldType === 'autoNumber'
    ) {
      return `(SELECT CASE
        WHEN lkp.elem IS NULL OR jsonb_typeof(lkp.elem) = 'null' THEN NULL
        ELSE (lkp.elem #>> '{}')::numeric
      END
      FROM (SELECT (${normalizedJson} -> 0) AS elem) AS lkp)`;
    }

    // Date types: extract as text (for unwrapArrayToScalar which always returns string type)
    // The actual datetime conversion happens in coerceToDatetime
    if (
      innerFieldType === 'date' ||
      innerFieldType === 'createdTime' ||
      innerFieldType === 'lastModifiedTime'
    ) {
      return `(SELECT CASE
        WHEN lkp.elem IS NULL OR jsonb_typeof(lkp.elem) = 'null' THEN NULL
        ELSE lkp.elem #>> '{}'
      END
      FROM (SELECT (${normalizedJson} -> 0) AS elem) AS lkp)`;
    }

    // Text types: extract as text
    if (
      innerFieldType === 'singleLineText' ||
      innerFieldType === 'longText' ||
      innerFieldType === 'singleSelect' ||
      innerFieldType === 'multipleSelect'
    ) {
      return `(SELECT CASE
        WHEN lkp.elem IS NULL OR jsonb_typeof(lkp.elem) = 'null' THEN NULL
        ELSE lkp.elem #>> '{}'
      END
      FROM (SELECT (${normalizedJson} -> 0) AS elem) AS lkp)`;
    }

    // Boolean type: extract as boolean
    if (innerFieldType === 'checkbox') {
      return `(SELECT CASE
        WHEN lkp.elem IS NULL OR jsonb_typeof(lkp.elem) = 'null' THEN NULL
        WHEN (lkp.elem #>> '{}')::boolean THEN TRUE
        ELSE FALSE
      END
      FROM (SELECT (${normalizedJson} -> 0) AS elem) AS lkp)`;
    }

    // User type: extract using object text extraction
    if (
      innerFieldType === 'user' ||
      innerFieldType === 'createdBy' ||
      innerFieldType === 'lastModifiedBy'
    ) {
      return this.buildFirstElementText(
        normalizedJson,
        this.buildJsonObjectText('lkp.elem'),
        'lkp'
      );
    }

    // Default: use generic extraction logic
    return `(SELECT CASE
      WHEN lkp.elem IS NULL OR jsonb_typeof(lkp.elem) = 'null' THEN NULL
      ELSE ${extractJsonScalarText('lkp.elem')}
    END
    FROM (SELECT (${normalizedJson} -> 0) AS elem) AS lkp)`;
  }

  protected stringifyArrayExpr(expr: SqlExpr, separator = ', '): string {
    const normalized = this.normalizeArrayExpr(expr);

    // Check if this is a lookup field with a known innerField type
    const innerField = this.getLookupInnerField(expr);
    if (innerField) {
      return this.stringifyLookupArrayExpr(normalized, innerField, separator);
    }

    if (this.isJsonArrayObjectField(expr)) {
      return this.stringifyNormalizedJsonArrayWithElement(
        normalized,
        this.buildJsonObjectText('elem'),
        separator
      );
    }
    if (this.isJsonArrayScalarField(expr)) {
      return this.stringifyNormalizedJsonArrayWithElement(normalized, "elem #>> '{}'", separator);
    }
    return stringifyNormalizedJsonArray(normalized, separator);
  }

  /**
   * Stringify a lookup field array based on its innerField type.
   * This optimizes SQL generation by using type-specific extraction logic.
   */
  protected stringifyLookupArrayExpr(
    normalizedJson: string,
    innerField: Field,
    separator = ', '
  ): string {
    const innerFieldType = innerField.type().toString();

    // Button, link, and attachment types: extract as object text
    if (
      innerFieldType === 'button' ||
      innerFieldType === 'link' ||
      innerFieldType === 'attachment'
    ) {
      return this.stringifyNormalizedJsonArrayWithElement(
        normalizedJson,
        this.buildJsonObjectText('elem'),
        separator
      );
    }

    // User types: extract as object text
    if (
      innerFieldType === 'user' ||
      innerFieldType === 'createdBy' ||
      innerFieldType === 'lastModifiedBy'
    ) {
      return this.stringifyNormalizedJsonArrayWithElement(
        normalizedJson,
        this.buildJsonObjectText('elem'),
        separator
      );
    }

    // Text types: extract as text
    if (
      innerFieldType === 'singleLineText' ||
      innerFieldType === 'longText' ||
      innerFieldType === 'singleSelect' ||
      innerFieldType === 'multipleSelect'
    ) {
      return this.stringifyNormalizedJsonArrayWithElement(
        normalizedJson,
        "elem #>> '{}'",
        separator
      );
    }

    // Number types: extract as text (for stringification)
    if (
      innerFieldType === 'number' ||
      innerFieldType === 'rating' ||
      innerFieldType === 'autoNumber'
    ) {
      const formatted = formatFieldValueAsStringSql(
        innerField,
        "elem #>> '{}'",
        'number',
        this.formulaTimeZone()
      );
      return this.stringifyNormalizedJsonArrayWithElement(
        normalizedJson,
        formatted ?? "(elem #>> '{}')::text",
        separator
      );
    }

    // Date types: extract as text (for stringification)
    // Note: For date types, we extract as text directly since stringification needs text
    if (
      innerFieldType === 'date' ||
      innerFieldType === 'createdTime' ||
      innerFieldType === 'lastModifiedTime'
    ) {
      const formatted = formatFieldValueAsStringSql(
        innerField,
        "elem #>> '{}'",
        'datetime',
        this.formulaTimeZone()
      );
      return this.stringifyNormalizedJsonArrayWithElement(
        normalizedJson,
        formatted ?? "elem #>> '{}'",
        separator
      );
    }

    // Boolean type: extract as text
    if (innerFieldType === 'checkbox') {
      return this.stringifyNormalizedJsonArrayWithElement(
        normalizedJson,
        "(elem #>> '{}')::text",
        separator
      );
    }

    // Default: use generic extraction logic
    return stringifyNormalizedJsonArray(normalizedJson, separator);
  }

  protected unwrapArrayToScalar(expr: SqlExpr): SqlExpr {
    if (!expr.isArray) return expr;
    const scalarText = this.extractArrayScalarText(expr);
    const lookupValueType = this.resolveLookupScalarValueType(expr);
    const valueType =
      lookupValueType ??
      (expr.valueType === 'number' || expr.valueType === 'boolean' || expr.valueType === 'datetime'
        ? expr.valueType
        : 'string');
    return makeExpr(
      scalarText,
      valueType,
      false,
      expr.errorConditionSql,
      expr.errorMessageSql,
      expr.field,
      'scalar'
    );
  }

  protected coerceToString(
    expr: SqlExpr,
    applyFormatting = true,
    timeZoneOverride?: string
  ): SqlExpr {
    if (expr.isArray) {
      return makeExpr(
        this.stringifyArrayExpr(expr),
        'string',
        false,
        expr.errorConditionSql,
        expr.errorMessageSql,
        expr.field,
        'scalar'
      );
    }
    if (expr.storageKind === 'json') {
      // For known JSON storage fields, use direct cast instead of safeJsonbWithStrategy
      const jsonbValue = `(${expr.valueSql})::jsonb`;
      const valueSql = this.isStructuredJsonField(expr)
        ? this.buildJsonObjectText(jsonbValue)
        : extractJsonScalarText(jsonbValue);
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
    if (expr.valueType === 'string') return expr;
    if (applyFormatting) {
      const formattedSql = this.formatScalarForString(expr, timeZoneOverride);
      if (formattedSql) {
        return makeExpr(
          formattedSql,
          'string',
          false,
          expr.errorConditionSql,
          expr.errorMessageSql,
          expr.field,
          'scalar'
        );
      }
    }
    const valueSql = `(${expr.valueSql})::text`;
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

  protected formatScalarForString(expr: SqlExpr, timeZoneOverride?: string): string | undefined {
    return formatFieldValueAsStringSql(
      expr.field,
      expr.valueSql,
      expr.valueType,
      timeZoneOverride ?? this.formulaTimeZone()
    );
  }

  protected coerceToBoolean(expr: SqlExpr): SqlExpr {
    if (expr.isArray) {
      const normalizedArray = this.normalizeArrayExpr(expr);
      const valueSql = guardValueSql(
        `(CASE
          WHEN ${normalizedArray} IS NULL OR jsonb_typeof(${normalizedArray}) = 'null' THEN FALSE
          WHEN jsonb_typeof(${normalizedArray}) = 'array' THEN jsonb_array_length(${normalizedArray}) > 0
          ELSE TRUE
        END)`,
        expr.errorConditionSql
      );
      return makeExpr(
        valueSql,
        'boolean',
        false,
        expr.errorConditionSql,
        expr.errorMessageSql,
        expr.field
      );
    }
    const base = this.unwrapArrayToScalar(expr);
    if (base.valueType === 'boolean') {
      const valueSql = `COALESCE(${base.valueSql}, FALSE)`;
      return makeExpr(
        valueSql,
        'boolean',
        false,
        base.errorConditionSql,
        base.errorMessageSql,
        base.field
      );
    }
    if (base.valueType === 'number') {
      const valueSql = `(CASE WHEN ${base.valueSql} IS NULL THEN FALSE WHEN ${base.valueSql} <> 0 THEN TRUE ELSE FALSE END)`;
      return makeExpr(
        valueSql,
        'boolean',
        false,
        base.errorConditionSql,
        base.errorMessageSql,
        base.field
      );
    }
    const textValue = this.coerceToString(base);
    const trimmed = `BTRIM(${textValue.valueSql})`;
    const valueSql = `(CASE
      WHEN ${textValue.valueSql} IS NULL THEN FALSE
      WHEN ${trimmed} = '' THEN FALSE
      WHEN LOWER(${trimmed}) IN ('false','0','no','off','null') THEN FALSE
      ELSE TRUE
    END)`;
    return makeExpr(
      valueSql,
      'boolean',
      false,
      textValue.errorConditionSql,
      textValue.errorMessageSql,
      base.field
    );
  }

  protected coerceToNumber(expr: SqlExpr, reason: string): SqlExpr {
    const base = this.unwrapArrayToScalar(expr);

    // Compile-time short-circuit: Check lookup field's innerField type for early error detection
    // Only button and link are truly non-convertible; attachment/user can extract name for text->number
    const innerFieldType = this.getLookupInnerFieldType(base);
    if (innerFieldType === 'button' || innerFieldType === 'link') {
      return makeExpr(
        'NULL::double precision',
        'number',
        false,
        'TRUE',
        buildErrorLiteral('TYPE', 'cannot_cast_to_number'),
        base.field
      );
    }

    // Compile-time short-circuit: button and link JSON object fields can never be converted to numbers
    // (they don't have meaningful numeric representations)
    if (this.isJsonObjectField(base)) {
      return makeExpr(
        'NULL::double precision',
        'number',
        false,
        'TRUE',
        buildErrorLiteral('TYPE', 'cannot_cast_to_number'),
        base.field
      );
    }

    if (base.valueType === 'number') {
      return makeExpr(
        `(${base.valueSql})::double precision`,
        'number',
        false,
        base.errorConditionSql,
        base.errorMessageSql,
        base.field
      );
    }
    if (base.valueType === 'boolean') {
      const valueSql = `(CASE WHEN ${base.valueSql} IS NULL THEN NULL WHEN ${base.valueSql} THEN 1 ELSE 0 END)::double precision`;
      return makeExpr(
        valueSql,
        'number',
        false,
        base.errorConditionSql,
        base.errorMessageSql,
        base.field
      );
    }
    if (base.valueType === 'datetime') {
      return makeExpr(
        'NULL::double precision',
        'number',
        false,
        'TRUE',
        buildErrorLiteral('TYPE', `cannot_cast_datetime_to_number_${reason}`),
        base.field
      );
    }

    const textValue = this.coerceToString(base);
    const numericCast = this.buildLooseNumericCast(textValue.valueSql);
    const valueSql = numericCast.valueSql;
    const errorCondition = numericCast.invalidSql;
    const combinedErrorCondition = combineErrorConditions([
      textValue,
      makeExpr(
        'NULL',
        'number',
        false,
        errorCondition,
        buildErrorLiteral('TYPE', 'cannot_cast_to_number')
      ),
    ]);
    const errorMessage = buildErrorMessageSql(
      [
        textValue,
        makeExpr(
          'NULL',
          'number',
          false,
          errorCondition,
          buildErrorLiteral('TYPE', 'cannot_cast_to_number')
        ),
      ],
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    const guardedValue = guardValueSql(valueSql, combinedErrorCondition);
    return makeExpr(
      guardedValue,
      'number',
      false,
      combinedErrorCondition,
      errorMessage,
      base.field
    );
  }

  protected coerceToDatetime(expr: SqlExpr): SqlExpr {
    const base = this.unwrapArrayToScalar(expr);

    // Check lookup field's innerField type for early error detection
    const innerFieldType = this.getLookupInnerFieldType(base);
    if (
      innerFieldType === 'button' ||
      innerFieldType === 'link' ||
      innerFieldType === 'attachment'
    ) {
      return makeExpr(
        'NULL::timestamptz',
        'datetime',
        false,
        'TRUE',
        buildErrorLiteral('TYPE', 'cannot_cast_to_datetime'),
        base.field
      );
    }

    if (this.isStructuredJsonField(base) || this.isNonDatetimeField(base)) {
      return makeExpr(
        'NULL::timestamptz',
        'datetime',
        false,
        'TRUE',
        buildErrorLiteral('TYPE', 'cannot_cast_to_datetime'),
        base.field
      );
    }
    if (base.valueType === 'datetime') {
      return makeExpr(
        `(${base.valueSql})::timestamptz`,
        'datetime',
        false,
        base.errorConditionSql,
        base.errorMessageSql,
        base.field
      );
    }
    if (base.valueType === 'number') {
      const valueSql = `to_timestamp((${base.valueSql})::double precision)`;
      return makeExpr(
        valueSql,
        'datetime',
        false,
        base.errorConditionSql,
        base.errorMessageSql,
        base.field
      );
    }
    if (base.valueType === 'boolean') {
      return makeExpr(
        'NULL::timestamptz',
        'datetime',
        false,
        'TRUE',
        buildErrorLiteral('TYPE', 'cannot_cast_boolean_to_datetime')
      );
    }

    const textValue = this.coerceToString(base);
    const valueSql = this.withValueAlias(textValue.valueSql, (ref) => {
      const textSql = `(${ref})::text`;
      const validTimestamp = this.typeValidation.isValidForType(textSql, 'timestamptz');
      const validTimestampNoTz = this.typeValidation.isValidForType(textSql, 'timestamp');
      return `(CASE
        WHEN ${ref} IS NULL THEN NULL::timestamptz
        WHEN ${validTimestamp} THEN (${textSql})::timestamptz
        WHEN ${validTimestampNoTz} THEN ${this.interpretTimestampInFormulaTimeZone(textSql)}
        ELSE NULL::timestamptz
      END)`;
    });
    const errorCondition = this.withValueAlias(textValue.valueSql, (ref) => {
      const textSql = `(${ref})::text`;
      const validTimestamp = this.typeValidation.isValidForType(textSql, 'timestamptz');
      const validTimestampNoTz = this.typeValidation.isValidForType(textSql, 'timestamp');
      return `(${ref} IS NOT NULL AND NOT (${validTimestamp} OR ${validTimestampNoTz}))`;
    });
    const combinedErrorCondition = combineErrorConditions([
      textValue,
      makeExpr(
        'NULL',
        'datetime',
        false,
        errorCondition,
        buildErrorLiteral('TYPE', 'cannot_cast_to_datetime')
      ),
    ]);
    const errorMessage = buildErrorMessageSql(
      [
        textValue,
        makeExpr(
          'NULL',
          'datetime',
          false,
          errorCondition,
          buildErrorLiteral('TYPE', 'cannot_cast_to_datetime')
        ),
      ],
      buildErrorLiteral('TYPE', 'cannot_cast_to_datetime')
    );
    const guardedValue = guardValueSql(valueSql, combinedErrorCondition);
    return makeExpr(
      guardedValue,
      'datetime',
      false,
      combinedErrorCondition,
      errorMessage,
      base.field
    );
  }

  protected buildLooseNumericComparison(left: SqlExpr, right: SqlExpr, operator: string): string {
    const leftText = this.coerceToString(left, false);
    const rightText = this.coerceToString(right, false);
    const leftNumeric = this.buildLooseNumericCast(leftText.valueSql);
    const rightNumeric = this.buildLooseNumericCast(rightText.valueSql);
    const leftNull = `(${leftText.valueSql} IS NULL)`;
    const rightNull = `(${rightText.valueSql} IS NULL)`;
    const numericCondition = `(${leftNumeric.castableSql} OR ${leftNull}) AND (${rightNumeric.castableSql} OR ${rightNull})`;
    const emptyText = sqlStringLiteral('');
    const leftValue = `COALESCE(${leftText.valueSql}, ${emptyText})`;
    const rightValue = `COALESCE(${rightText.valueSql}, ${emptyText})`;
    return `(CASE
      WHEN ${numericCondition} THEN (COALESCE(${leftNumeric.valueSql}, 0) ${operator} COALESCE(${rightNumeric.valueSql}, 0))
      ELSE (${leftValue} ${operator} ${rightValue})
    END)`;
  }

  protected buildLooseDatetimeComparison(left: SqlExpr, right: SqlExpr, operator: string): string {
    const leftText = this.coerceToString(left);
    const rightText = this.coerceToString(right);
    const leftDatetime = this.buildLooseDatetimeCast(leftText.valueSql);
    const rightDatetime = this.buildLooseDatetimeCast(rightText.valueSql);
    const datetimeCondition = `(${leftDatetime.castableSql} AND ${rightDatetime.castableSql})`;
    const emptyText = sqlStringLiteral('');
    const leftValue = `COALESCE(${leftText.valueSql}, ${emptyText})`;
    const rightValue = `COALESCE(${rightText.valueSql}, ${emptyText})`;
    return `(CASE
      WHEN ${datetimeCondition} THEN (${leftDatetime.valueSql} ${operator} ${rightDatetime.valueSql})
      ELSE (${leftValue} ${operator} ${rightValue})
    END)`;
  }

  protected buildLooseNumericCast(valueSql: string): {
    valueSql: string;
    castableSql: string;
    invalidSql: string;
  } {
    // Extract numeric prefix from text (matches v1 VALUE() function behavior).
    // Examples: "42" → 42, "10天" → 10, "3.14pi" → 3.14, "-5meters" → -5
    // Intentionally disallow scientific notation (e.g. "3.7e+35") so that SUM/AVERAGE over
    // multi-value lookups can safely ignore such strings instead of coercing them into malformed numerics.
    const numericPattern = sqlStringLiteral('^([+-]?\\d+\\.?\\d*|[+-]?\\d*\\.\\d+)');
    const exponentPattern = sqlStringLiteral('^([+-]?\\d+\\.?\\d*|[+-]?\\d*\\.\\d+)[eE][+-]?\\d+');
    const valueExpr = this.withValueAlias(valueSql, (ref) => {
      const textSql = `(${ref})::text`;
      const trimmed = `BTRIM(${textSql})`;
      const normalized = `NULLIF(REGEXP_REPLACE(${trimmed}, '[,\\s]', '', 'g'), '')`;
      // Extract numeric prefix instead of requiring exact match
      const extracted = `SUBSTRING(${normalized} FROM ${numericPattern})`;
      const hasExponent = `(${normalized} IS NOT NULL AND ${normalized} ~ ${exponentPattern})`;
      const validExtracted = `(${extracted} IS NOT NULL AND NOT ${hasExponent} AND ${this.typeValidation.isValidForType(extracted, 'numeric')})`;
      return `(CASE
        WHEN ${normalized} IS NULL THEN NULL
        WHEN ${validExtracted} THEN (${extracted})::double precision
        ELSE NULL
      END)`;
    });
    const castableExpr = this.withValueAlias(valueSql, (ref) => {
      const textSql = `(${ref})::text`;
      const trimmed = `BTRIM(${textSql})`;
      const normalized = `NULLIF(REGEXP_REPLACE(${trimmed}, '[,\\s]', '', 'g'), '')`;
      const extracted = `SUBSTRING(${normalized} FROM ${numericPattern})`;
      const hasExponent = `(${normalized} IS NOT NULL AND ${normalized} ~ ${exponentPattern})`;
      return `(${extracted} IS NOT NULL AND NOT ${hasExponent} AND ${this.typeValidation.isValidForType(extracted, 'numeric')})`;
    });
    const invalidExpr = this.withValueAlias(valueSql, (ref) => {
      const textSql = `(${ref})::text`;
      const trimmed = `BTRIM(${textSql})`;
      const normalized = `NULLIF(REGEXP_REPLACE(${trimmed}, '[,\\s]', '', 'g'), '')`;
      const extracted = `SUBSTRING(${normalized} FROM ${numericPattern})`;
      const hasExponent = `(${normalized} IS NOT NULL AND ${normalized} ~ ${exponentPattern})`;
      const validExtracted = `(${extracted} IS NOT NULL AND NOT ${hasExponent} AND ${this.typeValidation.isValidForType(extracted, 'numeric')})`;
      return `(${normalized} IS NOT NULL AND NOT ${validExtracted})`;
    });
    return { valueSql: valueExpr, castableSql: castableExpr, invalidSql: invalidExpr };
  }

  protected buildLooseDatetimeCast(valueSql: string): { valueSql: string; castableSql: string } {
    const valueExpr = this.withValueAlias(valueSql, (ref) => {
      const textSql = `(${ref})::text`;
      const validTimestamp = this.typeValidation.isValidForType(textSql, 'timestamptz');
      const validTimestampNoTz = this.typeValidation.isValidForType(textSql, 'timestamp');
      return `(CASE
        WHEN ${validTimestamp} THEN (${textSql})::timestamptz
        WHEN ${validTimestampNoTz} THEN ${this.interpretTimestampInFormulaTimeZone(textSql)}
        ELSE NULL
      END)`;
    });
    const castableExpr = this.withValueAlias(valueSql, (ref) => {
      const textSql = `(${ref})::text`;
      return `(${this.typeValidation.isValidForType(textSql, 'timestamptz')} OR ${this.typeValidation.isValidForType(textSql, 'timestamp')})`;
    });
    return { valueSql: valueExpr, castableSql: castableExpr };
  }

  protected getStringLiteralValue(expr: SqlExpr): string | undefined {
    if (expr.isArray || expr.valueType !== 'string') return undefined;
    const trimmed = expr.valueSql.trim();
    if (trimmed.length < 2 || !trimmed.startsWith("'") || !trimmed.endsWith("'")) {
      return undefined;
    }
    const inner = trimmed.slice(1, -1);
    return inner.replace(/''/g, "'");
  }

  protected isBlankStringLiteral(expr: SqlExpr | undefined): boolean {
    if (!expr) return false;
    return this.getStringLiteralValue(expr) === '';
  }

  private nullIfBlankText(expr: SqlExpr): SqlExpr {
    if (expr.isArray || expr.valueType !== 'string') return expr;
    const textValue = `(${expr.valueSql})::text`;
    const trimmedValue = `BTRIM(${textValue})`;
    const valueSql = `(CASE
      WHEN ${expr.valueSql} IS NULL THEN NULL
      WHEN ${trimmedValue} = '' THEN NULL
      ELSE ${expr.valueSql}
    END)`;
    return makeExpr(
      valueSql,
      'string',
      false,
      expr.errorConditionSql,
      expr.errorMessageSql,
      expr.field,
      expr.storageKind
    );
  }

  protected getFieldTypeName(expr: SqlExpr): string | undefined {
    return expr.field?.type().toString();
  }

  private isLookupArrayField(expr: SqlExpr): boolean {
    if (!expr.field) return false;
    return (
      expr.field.type().equals(FieldType.lookup()) ||
      expr.field.type().equals(FieldType.conditionalLookup())
    );
  }

  private normalizeLookupArrayExpr(expr: SqlExpr): string {
    const base = `(${expr.valueSql})`;
    // Lookup fields may come from various sources. Use safeJsonbWithStrategy for type safety.
    if (expr.field && this.isLookupArrayField(expr)) {
      const jsonbBase = safeJsonbWithStrategy(base, this.typeValidation);
      // Use subquery to cache jsonbBase, avoiding repeated evaluation
      return `(SELECT CASE
        WHEN _lkp.v IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(_lkp.v) = 'null' THEN '[]'::jsonb
        WHEN jsonb_typeof(_lkp.v) = 'array' THEN _lkp.v
        ELSE jsonb_build_array(_lkp.v)
      END FROM (SELECT ${jsonbBase} AS v) AS _lkp)`;
    }
    const jsonbBase = `${base}::jsonb`;
    const jsonbStringValue = `(${jsonbBase} #>> '{}')`;
    const jsonbStringTrimmed = `BTRIM(${jsonbStringValue})`;
    const jsonbStringLooksJson = `(LEFT(${jsonbStringTrimmed}, 1) IN ('[', '{'))`;
    const jsonbStringValid = this.typeValidation.isValidForType(jsonbStringValue, 'jsonb');
    const parsedJsonb = `(CASE
      WHEN pg_typeof(${base}) = 'jsonb'::regtype THEN
        CASE
          WHEN jsonb_typeof(${jsonbBase}) = 'string' AND ${jsonbStringLooksJson} AND ${jsonbStringValid}
            THEN (${jsonbStringValue})::jsonb
          ELSE ${jsonbBase}
        END
      WHEN pg_typeof(${base}) = 'json'::regtype THEN ${base}::jsonb
      ELSE to_jsonb(${base})
    END)`;
    // Use subquery to cache parsedJsonb, avoiding repeated evaluation
    return `(SELECT CASE
      WHEN ${base} IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(_pj.v) = 'array' THEN _pj.v
      WHEN jsonb_typeof(_pj.v) = 'null' THEN '[]'::jsonb
      ELSE jsonb_build_array(_pj.v)
    END FROM (SELECT ${parsedJsonb} AS v) AS _pj)`;
  }

  /**
   * Get the inner field type of a lookup field, if applicable.
   * Returns null if the field is not a lookup field or if the inner field is not resolved.
   */
  protected getLookupInnerFieldType(expr: SqlExpr): string | null {
    const innerField = this.getLookupInnerField(expr);
    return innerField?.type().toString() ?? null;
  }

  private getLookupInnerField(expr: SqlExpr): Field | null {
    if (!expr.field) return null;
    const field = expr.field;

    if (field.type().equals(FieldType.lookup())) {
      const lookupField = field as LookupField;
      const innerFieldResult = lookupField.innerField();
      if (innerFieldResult.isErr()) return null;
      return innerFieldResult.value;
    }

    if (field.type().equals(FieldType.conditionalLookup())) {
      const conditionalField = field as ConditionalLookupField;
      const innerFieldResult = conditionalField.innerField();
      if (innerFieldResult.isErr()) return null;
      return innerFieldResult.value;
    }

    return null;
  }

  private resolveLookupScalarValueType(expr: SqlExpr): SqlValueType | null {
    const innerField = this.getLookupInnerField(expr);
    if (!innerField) return null;
    if (innerField.type().equals(FieldType.formula())) {
      const metadataResult = buildFieldSqlMetadata(innerField);
      if (metadataResult.isOk()) {
        return metadataResult.value.valueType;
      }
      return null;
    }
    const innerFieldType = innerField.type().toString();
    if (innerFieldType === 'checkbox') return 'boolean';
    if (
      innerFieldType === 'number' ||
      innerFieldType === 'rating' ||
      innerFieldType === 'autoNumber'
    ) {
      return 'number';
    }
    if (
      innerFieldType === 'date' ||
      innerFieldType === 'createdTime' ||
      innerFieldType === 'lastModifiedTime'
    ) {
      return 'datetime';
    }
    return 'string';
  }

  protected isStructuredJsonField(expr: SqlExpr): boolean {
    const type = this.getFieldTypeName(expr);
    if (!type) return false;
    return JSON_OBJECT_FIELD_TYPES.has(type) || JSON_ARRAY_OBJECT_FIELD_TYPES.has(type);
  }

  protected isJsonObjectField(expr: SqlExpr): boolean {
    const type = this.getFieldTypeName(expr);
    return Boolean(type && JSON_OBJECT_FIELD_TYPES.has(type));
  }

  protected isJsonArrayObjectField(expr: SqlExpr): boolean {
    const type = this.getFieldTypeName(expr);
    return Boolean(type && JSON_ARRAY_OBJECT_FIELD_TYPES.has(type));
  }

  protected isJsonArrayScalarField(expr: SqlExpr): boolean {
    const type = this.getFieldTypeName(expr);
    return Boolean(type && JSON_ARRAY_SCALAR_FIELD_TYPES.has(type));
  }

  /**
   * Check if valueSql is a simple column reference like "alias"."column"
   * These are safe for direct ::jsonb cast without runtime type checks.
   */
  protected isDirectColumnReference(valueSql: string): boolean {
    // Match patterns like "t"."ColName" or "alias"."col_name"
    const trimmed = valueSql.trim();
    // Simple pattern: "identifier"."identifier" (with optional parentheses)
    const columnRefPattern = /^\(?"\w+"\."\w+"\)?$/;
    return columnRefPattern.test(trimmed);
  }

  protected isNonDatetimeField(expr: SqlExpr): boolean {
    const type = this.getFieldTypeName(expr);
    return Boolean(type && NON_DATETIME_FIELD_TYPES.has(type));
  }

  protected isDatetimeField(expr: SqlExpr): boolean {
    const type = this.getFieldTypeName(expr);
    return type === 'date' || type === 'createdTime' || type === 'lastModifiedTime';
  }

  protected isUnitStringCompatibleField(expr: SqlExpr): boolean {
    // 检查字段类型是否可能包含有效的单位字符串
    if (!expr.field) {
      if (expr.isArray) return false;
      if (expr.valueType === 'string' || expr.valueType === 'unknown') return true;
      return false;
    }

    const fieldType = this.getFieldTypeName(expr);
    if (!fieldType) return true; // 无法确定类型，需要运行时检查

    // Formula字段在解析时会被展开，但作为单位参数，formula字段的值类型是动态的
    // 在编译期无法确定其值类型，因此不应该被视为单位字符串兼容字段
    if (fieldType === 'formula') {
      return false;
    }

    // 字符串类型字段可能包含有效的单位字符串
    if (fieldType === 'singleLineText' || fieldType === 'longText') {
      return true;
    }

    // 其他类型字段不可能包含有效的单位字符串
    return false;
  }

  protected canFieldBeDatetimeString(expr: SqlExpr): boolean {
    // 检查字段是否可能包含有效的日期时间字符串
    if (!expr.field) {
      if (expr.isArray) return false;
      if (
        expr.valueType === 'string' ||
        expr.valueType === 'datetime' ||
        expr.valueType === 'unknown'
      ) {
        return true;
      }
      return false;
    }

    // 如果是非日期时间兼容字段，不可能包含有效的日期时间字符串
    if (this.isNonDatetimeField(expr) || this.isStructuredJsonField(expr)) {
      return false;
    }

    return true;
  }

  protected buildJsonObjectText(ref: string): string {
    return `COALESCE(${ref}->>'title', ${ref}->>'name', ${ref} #>> '{}')`;
  }

  protected stringifyNormalizedJsonArrayWithElement(
    normalizedJson: string,
    elementSql: string,
    separator = ', '
  ): string {
    const sepLiteral = sqlStringLiteral(separator);
    return `(
      SELECT string_agg(${elementSql}, ${sepLiteral} ORDER BY ord)
      FROM jsonb_array_elements(${normalizedJson}) WITH ORDINALITY AS _jae(elem, ord)
    )`;
  }

  protected buildFirstElementText(
    normalizedJson: string,
    elementSql: string,
    tableAlias = 'fe'
  ): string {
    return `(SELECT CASE
      WHEN ${tableAlias}.elem IS NULL OR jsonb_typeof(${tableAlias}.elem) = 'null' THEN NULL
      ELSE ${elementSql}
    END
    FROM (SELECT (${normalizedJson} -> 0) AS elem) AS ${tableAlias})`;
  }

  protected normalizeUnitLiteral<T extends string>(
    literal: string | undefined,
    aliases: Record<string, T>
  ): T | undefined {
    if (!literal) return undefined;
    return aliases[literal.trim().toLowerCase()];
  }

  protected buildDateAddSql(unit: DateAddUnit, dateSql: string, countSql: string): string {
    return `${dateSql} + (${countSql}) * ${DATE_ADD_INTERVALS[unit]}`;
  }

  protected buildDateAddCaseSql(unitSql: string, dateSql: string, countSql: string): string {
    return `(CASE
      WHEN ${unitSql} IN ('year', 'years') THEN ${this.buildDateAddSql('year', dateSql, countSql)}
      WHEN ${unitSql} IN ('quarter', 'quarters') THEN ${this.buildDateAddSql(
        'quarter',
        dateSql,
        countSql
      )}
      WHEN ${unitSql} IN ('month', 'months') THEN ${this.buildDateAddSql(
        'month',
        dateSql,
        countSql
      )}
      WHEN ${unitSql} IN ('week', 'weeks') THEN ${this.buildDateAddSql('week', dateSql, countSql)}
      WHEN ${unitSql} IN ('day', 'days') THEN ${this.buildDateAddSql('day', dateSql, countSql)}
      WHEN ${unitSql} IN ('hour', 'hours') THEN ${this.buildDateAddSql('hour', dateSql, countSql)}
      WHEN ${unitSql} IN ('minute', 'minutes') THEN ${this.buildDateAddSql(
        'minute',
        dateSql,
        countSql
      )}
      WHEN ${unitSql} IN ('second', 'seconds') THEN ${this.buildDateAddSql(
        'second',
        dateSql,
        countSql
      )}
      ELSE NULL::timestamptz
    END)`;
  }

  protected buildDatetimeDiffSql(
    unit: DatetimeDiffUnit,
    diffSeconds: string,
    diffMonths: string,
    diffYears: string
  ): string {
    const sqlByUnit: Record<DatetimeDiffUnit, string> = {
      millisecond: `TRUNC((${diffSeconds}) * 1000)`,
      second: `TRUNC((${diffSeconds}))`,
      minute: `TRUNC((${diffSeconds}) / 60)`,
      hour: `TRUNC((${diffSeconds}) / 3600)`,
      day: `TRUNC((${diffSeconds}) / 86400)`,
      week: `TRUNC((${diffSeconds}) / (86400 * 7))`,
      month: `TRUNC(${diffMonths})`,
      quarter: `TRUNC((${diffMonths}) / 3.0)`,
      year: `TRUNC(${diffYears})`,
    };
    return sqlByUnit[unit];
  }

  protected buildDatetimeDiffCaseSql(
    unitSql: string,
    diffSeconds: string,
    diffMonths: string,
    diffYears: string
  ): string {
    return `(CASE
      WHEN ${unitSql} IN ('millisecond', 'milliseconds') THEN TRUNC((${diffSeconds}) * 1000)
      WHEN ${unitSql} IN ('second', 'seconds') THEN TRUNC((${diffSeconds}))
      WHEN ${unitSql} IN ('minute', 'minutes') THEN TRUNC((${diffSeconds}) / 60)
      WHEN ${unitSql} IN ('hour', 'hours') THEN TRUNC((${diffSeconds}) / 3600)
      WHEN ${unitSql} IN ('week', 'weeks') THEN TRUNC((${diffSeconds}) / (86400 * 7))
      WHEN ${unitSql} IN ('month', 'months') THEN TRUNC(${diffMonths})
      WHEN ${unitSql} IN ('quarter', 'quarters') THEN TRUNC((${diffMonths}) / 3.0)
      WHEN ${unitSql} IN ('year', 'years') THEN TRUNC(${diffYears})
      WHEN ${unitSql} IN ('day', 'days') THEN TRUNC((${diffSeconds}) / 86400)
      ELSE NULL::double precision
    END)`;
  }

  protected buildIsSameSql(unit: IsSameUnit, leftSql: string, rightSql: string): string {
    const left = this.applyFormulaTimeZone(leftSql);
    const right = this.applyFormulaTimeZone(rightSql);
    const sqlByUnit: Record<IsSameUnit, string> = {
      year: `DATE_TRUNC('year', ${left}) = DATE_TRUNC('year', ${right})`,
      month: `DATE_TRUNC('month', ${left}) = DATE_TRUNC('month', ${right})`,
      day: `DATE_TRUNC('day', ${left}) = DATE_TRUNC('day', ${right})`,
    };
    return sqlByUnit[unit];
  }

  protected buildIsSameCaseSql(unitSql: string, leftSql: string, rightSql: string): string {
    return `(CASE
      WHEN ${unitSql} IN ('year', 'years') THEN ${this.buildIsSameSql('year', leftSql, rightSql)}
      WHEN ${unitSql} IN ('month', 'months') THEN ${this.buildIsSameSql('month', leftSql, rightSql)}
      WHEN ${unitSql} IN ('day', 'days') THEN ${this.buildIsSameSql('day', leftSql, rightSql)}
      ELSE NULL
    END)`;
  }

  protected shortCircuitOnError(
    expr: SqlExpr,
    valueSql: string,
    valueType: SqlValueType,
    fallbackErrorMessage: string
  ): SqlExpr | undefined {
    if (expr.errorConditionSql !== 'TRUE') return undefined;
    return makeExpr(
      valueSql,
      valueType,
      false,
      'TRUE',
      expr.errorMessageSql ?? fallbackErrorMessage,
      expr.field
    );
  }

  protected withValueAlias(valueSql: string, buildBody: (ref: string) => string): string {
    const column = 'val';
    const tableAlias = 'v';
    const ref = `${tableAlias}.${column}`;
    return `(SELECT ${buildBody(ref)} FROM (SELECT ${valueSql} AS ${column}) AS ${tableAlias})`;
  }

  protected vectorizeArrayScalar(
    arrayExpr: SqlExpr,
    scalarExpr: SqlExpr,
    op: (leftSql: string, rightSql: string) => string,
    reason: string
  ): SqlExpr {
    const normalizedArray = this.normalizeArrayExpr(arrayExpr);
    const scalarNumber = this.coerceToNumber(scalarExpr, reason);
    const elemExpr = makeExpr(
      extractJsonScalarText('elem'),
      'unknown',
      false,
      arrayExpr.errorConditionSql,
      arrayExpr.errorMessageSql
    );
    const elementNumber = this.coerceToNumber(elemExpr, reason);
    const elementErrorCondition = combineErrorConditions([elementNumber, scalarNumber]);
    const elementErrorMessage = buildErrorMessageSql(
      [elementNumber, scalarNumber],
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    const elementValueSql = guardValueSql(
      op(elementNumber.valueSql, scalarNumber.valueSql),
      elementErrorCondition
    );
    const elementValueJson = `to_jsonb(${elementValueSql})`;
    const elementErrorJson = `to_jsonb(${elementErrorMessage ?? buildErrorLiteral('TYPE', 'cannot_cast_to_number')})`;
    const elementSql = elementErrorCondition
      ? `CASE WHEN ${elementErrorCondition} THEN ${elementErrorJson} ELSE ${elementValueJson} END`
      : elementValueSql;

    const valueSql = `(SELECT jsonb_agg(${elementSql} ORDER BY ord)
      FROM jsonb_array_elements(${normalizedArray}) WITH ORDINALITY AS _jae(elem, ord)
    )`;
    const errorCondition = combineErrorConditions([scalarNumber, arrayExpr]);
    const errorMessage = buildErrorMessageSql(
      [scalarNumber, arrayExpr],
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    return makeExpr(valueSql, 'number', true, errorCondition, errorMessage);
  }

  protected vectorizeUnaryNumeric(expr: SqlExpr, op: (valueSql: string) => string): SqlExpr {
    const normalizedArray = this.normalizeArrayExpr(expr);
    const elemExpr = makeExpr(
      extractJsonScalarText('elem'),
      'unknown',
      false,
      expr.errorConditionSql,
      expr.errorMessageSql
    );
    const elementNumber = this.coerceToNumber(elemExpr, 'unary');
    const elementErrorCondition = elementNumber.errorConditionSql;
    const elementErrorMessage =
      elementNumber.errorMessageSql ?? buildErrorLiteral('TYPE', 'cannot_cast_to_number');
    const elementValueSql = guardValueSql(op(elementNumber.valueSql), elementErrorCondition);
    const elementValueJson = `to_jsonb(${elementValueSql})`;
    const elementErrorJson = `to_jsonb(${elementErrorMessage})`;
    const elementSql = elementErrorCondition
      ? `CASE WHEN ${elementErrorCondition} THEN ${elementErrorJson} ELSE ${elementValueJson} END`
      : elementValueSql;

    const valueSql = `(SELECT jsonb_agg(${elementSql} ORDER BY ord)
      FROM jsonb_array_elements(${normalizedArray}) WITH ORDINALITY AS _jae(elem, ord)
    )`;
    const errorCondition = combineErrorConditions([expr, elementNumber]);
    const errorMessage = buildErrorMessageSql(
      [expr, elementNumber],
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    return makeExpr(valueSql, 'number', true, errorCondition, errorMessage);
  }

  protected coerceBranches(
    left: SqlExpr,
    right: SqlExpr
  ): { left: SqlExpr; right: SqlExpr; type: SqlValueType; isArray: boolean } {
    const leftBlank = this.isBlankStringLiteral(left);
    const rightBlank = this.isBlankStringLiteral(right);

    if (leftBlank && !rightBlank && right.valueType !== 'string') {
      const blankExpr = makeExpr('NULL', right.valueType, right.isArray, undefined, undefined);
      return { left: blankExpr, right, type: right.valueType, isArray: right.isArray };
    }
    if (rightBlank && !leftBlank && left.valueType !== 'string') {
      const blankExpr = makeExpr('NULL', left.valueType, left.isArray, undefined, undefined);
      return { left, right: blankExpr, type: left.valueType, isArray: left.isArray };
    }

    const needsJsonStringCoercion =
      left.valueType === 'string' &&
      right.valueType === 'string' &&
      left.isArray === right.isArray &&
      !left.isArray &&
      (left.storageKind === 'json' || right.storageKind === 'json');
    if (needsJsonStringCoercion) {
      const textLeft = this.coerceToString(left);
      const textRight = this.coerceToString(right);
      return { left: textLeft, right: textRight, type: 'string', isArray: false };
    }

    if (left.valueType === right.valueType && left.isArray === right.isArray) {
      return { left, right, type: left.valueType, isArray: left.isArray };
    }

    if (left.isArray !== right.isArray) {
      const arrayExpr = left.isArray ? left : right;
      const scalarExpr = left.isArray ? right : left;
      const arrayScalar = this.unwrapArrayToScalar(arrayExpr);

      if (left.valueType === 'number' || right.valueType === 'number') {
        const numericLeft = this.coerceToNumber(left.isArray ? arrayScalar : left, 'if');
        const numericRight = this.coerceToNumber(left.isArray ? right : arrayScalar, 'if');
        return { left: numericLeft, right: numericRight, type: 'number', isArray: false };
      }

      if (left.valueType === 'datetime' || right.valueType === 'datetime') {
        const datetimeLeft = this.coerceToDatetime(left.isArray ? arrayScalar : left);
        const datetimeRight = this.coerceToDatetime(left.isArray ? right : arrayScalar);
        return { left: datetimeLeft, right: datetimeRight, type: 'datetime', isArray: false };
      }

      if (left.valueType === 'boolean' || right.valueType === 'boolean') {
        const boolLeft = this.coerceToBoolean(left.isArray ? arrayScalar : left);
        const boolRight = this.coerceToBoolean(left.isArray ? right : arrayScalar);
        return { left: boolLeft, right: boolRight, type: 'boolean', isArray: false };
      }

      const normalizedScalar = this.nullIfBlankText(scalarExpr);
      const normalizedLeft = left.isArray ? left : normalizedScalar;
      const normalizedRight = left.isArray ? normalizedScalar : right;
      const textLeft = this.coerceToString(normalizedLeft);
      const textRight = this.coerceToString(normalizedRight);
      return { left: textLeft, right: textRight, type: 'string', isArray: false };
    }

    if (left.valueType === 'number' || right.valueType === 'number') {
      const numericLeft = this.coerceToNumber(left, 'if');
      const numericRight = this.coerceToNumber(right, 'if');
      return { left: numericLeft, right: numericRight, type: 'number', isArray: false };
    }

    if (left.valueType === 'datetime' || right.valueType === 'datetime') {
      const datetimeLeft = this.coerceToDatetime(left);
      const datetimeRight = this.coerceToDatetime(right);
      return { left: datetimeLeft, right: datetimeRight, type: 'datetime', isArray: false };
    }

    if (left.valueType === 'boolean' || right.valueType === 'boolean') {
      const boolLeft = this.coerceToBoolean(left);
      const boolRight = this.coerceToBoolean(right);
      return { left: boolLeft, right: boolRight, type: 'boolean', isArray: false };
    }

    const textLeft = this.coerceToString(left);
    const textRight = this.coerceToString(right);
    return { left: textLeft, right: textRight, type: 'string', isArray: false };
  }

  protected coerceSwitchResults(
    results: SqlExpr[],
    defaultResult?: SqlExpr
  ): { results: SqlExpr[]; defaultValueSql?: string; type: SqlValueType; isArray: boolean } {
    if (results.length === 0) {
      return { results, type: 'string', isArray: false };
    }

    const nonBlankResults = results.filter((result) => !this.isBlankStringLiteral(result));
    const typeSeed = nonBlankResults[0] ?? defaultResult ?? results[0];
    const type: SqlValueType = typeSeed?.valueType ?? 'string';
    const isArray = typeSeed?.isArray ?? false;
    const hasJsonStorage =
      results.some((result) => result.storageKind === 'json') ||
      defaultResult?.storageKind === 'json';
    if (type === 'string' && !isArray && hasJsonStorage) {
      const casted = results.map((result) => this.coerceToString(result));
      const defaultValueSql = defaultResult
        ? this.coerceToString(defaultResult).valueSql
        : undefined;
      return { results: casted, type: 'string', isArray: false, defaultValueSql };
    }

    const nonBlankConsistent = nonBlankResults.every(
      (result) => result.valueType === type && result.isArray === isArray
    );
    const defaultConsistent =
      !defaultResult ||
      this.isBlankStringLiteral(defaultResult) ||
      (defaultResult.valueType === type && defaultResult.isArray === isArray);

    if (results.every((result) => result.valueType === type && result.isArray === isArray)) {
      return { results, type, isArray, defaultValueSql: defaultResult?.valueSql };
    }

    const shouldNullifyBlank = type !== 'string' && nonBlankConsistent && defaultConsistent;
    if (shouldNullifyBlank) {
      const coercedResults = results.map((result) =>
        this.isBlankStringLiteral(result)
          ? makeExpr('NULL', type, isArray, undefined, undefined)
          : result
      );
      const defaultValueSql = this.isBlankStringLiteral(defaultResult)
        ? 'NULL'
        : defaultResult?.valueSql;
      return { results: coercedResults, type, isArray, defaultValueSql };
    }

    const casted = results.map((result) => this.coerceToString(result));
    const defaultValueSql = defaultResult ? this.coerceToString(defaultResult).valueSql : undefined;
    return { results: casted, type: 'string', isArray: false, defaultValueSql };
  }
}
