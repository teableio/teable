/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable sonarjs/no-duplicate-string */
import {
  DateTimeFormatting,
  FieldType,
  type ConditionalLookupField,
  type LookupField,
  NumberFormatting,
  NumberFormattingType,
  TimeFormatting,
} from '@teable/v2-core';

import type { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import {
  buildErrorLiteral,
  extractFirstJsonScalarText,
  extractJsonScalarText,
  normalizeToJsonArray,
  sqlStringLiteral,
  stringifyNormalizedJsonArray,
} from './PgSqlHelpers';
import {
  buildErrorMessageSql,
  combineErrorConditions,
  guardValueSql,
  makeExpr,
  type SqlExpr,
  type SqlValueType,
} from './SqlExpression';

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
  constructor(protected readonly translator: FormulaSqlPgTranslator) {}

  public applyUnaryOp(kind: 'minus' | 'not', operand: SqlExpr): SqlExpr {
    if (kind === 'minus') {
      if (operand.isArray) {
        return this.vectorizeUnaryNumeric(operand, (value) => `(-(${value}))`);
      }
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
        return this.handleNumericOp('-', left, right, 'subtract');
      case '*':
        return this.handleNumericOp('*', left, right, 'multiply');
      case '/':
        return this.handleDivision(left, right);
      case '%':
        return this.handleNumericOp('%', left, right, 'modulo');
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
    if (left.isArray && right.isArray) {
      const leftScalar = this.unwrapArrayToScalar(left);
      const rightScalar = this.unwrapArrayToScalar(right);
      return this.handleNumericOp('+', leftScalar, rightScalar, 'add');
    }
    if (left.isArray) {
      return this.vectorizeArrayScalar(left, right, (l, r) => `(${l} + ${r})`, 'add');
    }
    if (right.isArray) {
      return this.vectorizeArrayScalar(right, left, (r, l) => `(${l} + ${r})`, 'add');
    }

    if (left.valueType === 'number' && right.valueType === 'number') {
      return this.handleNumericOp('+', left, right, 'add');
    }

    return this.handleStringConcat(left, right);
  }

  protected handleNumericOp(
    operator: string,
    left: SqlExpr,
    right: SqlExpr,
    reason: string
  ): SqlExpr {
    if (left.isArray && right.isArray) {
      const leftScalar = this.unwrapArrayToScalar(left);
      const rightScalar = this.unwrapArrayToScalar(right);
      return this.handleNumericOp(operator, leftScalar, rightScalar, reason);
    }
    if (left.isArray) {
      return this.vectorizeArrayScalar(left, right, (l, r) => `(${l} ${operator} ${r})`, reason);
    }
    if (right.isArray) {
      return this.vectorizeArrayScalar(right, left, (r, l) => `(${l} ${operator} ${r})`, reason);
    }

    const leftNumber = this.coerceToNumber(left, reason);
    const rightNumber = this.coerceToNumber(right, reason);
    const errorCondition = combineErrorConditions([leftNumber, rightNumber]);
    const errorMessage = buildErrorMessageSql(
      [leftNumber, rightNumber],
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    const valueSql = guardValueSql(
      `(${leftNumber.valueSql} ${operator} ${rightNumber.valueSql})`,
      errorCondition
    );
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  protected handleDivision(left: SqlExpr, right: SqlExpr): SqlExpr {
    if (left.isArray && right.isArray) {
      const leftScalar = this.unwrapArrayToScalar(left);
      const rightScalar = this.unwrapArrayToScalar(right);
      return this.handleDivision(leftScalar, rightScalar);
    }
    if (left.isArray) {
      return this.vectorizeArrayScalar(left, right, (l, r) => `(${l} / ${r})`, 'divide');
    }
    if (right.isArray) {
      return this.vectorizeArrayScalar(right, left, (r, l) => `(${l} / ${r})`, 'divide');
    }

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
    const valueSql = guardValueSql(
      `(${leftNumber.valueSql} / ${rightNumber.valueSql})`,
      errorCondition
    );
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  protected handleStringConcat(left: SqlExpr, right: SqlExpr): SqlExpr {
    const leftText = this.coerceToString(left);
    const rightText = this.coerceToString(right);
    const errorCondition = combineErrorConditions([leftText, rightText]);
    const errorMessage = buildErrorMessageSql(
      [leftText, rightText],
      buildErrorLiteral('TYPE', 'cannot_cast_to_text')
    );
    const valueSql = guardValueSql(
      `(${leftText.valueSql} || ${rightText.valueSql})`,
      errorCondition
    );
    return makeExpr(valueSql, 'string', false, errorCondition, errorMessage);
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

    const leftText = this.coerceToString(left);
    const rightText = this.coerceToString(right);
    const valueSql = guardValueSql(
      `(${leftText.valueSql} ${operator} ${rightText.valueSql})`,
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

    if (
      expr.storageKind === 'json' &&
      expr.isArray &&
      (this.isJsonArrayObjectField(expr) || this.isJsonArrayScalarField(expr))
    ) {
      return `COALESCE(NULLIF((${expr.valueSql})::jsonb, 'null'::jsonb), '[]'::jsonb)`;
    }
    if (expr.storageKind === 'array' || expr.storageKind === 'json') {
      const jsonValue =
        expr.storageKind === 'array' ? `to_jsonb(${expr.valueSql})` : `(${expr.valueSql})::jsonb`;
      return `(CASE
        WHEN ${expr.valueSql} IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(${jsonValue}) = 'array' THEN ${jsonValue}
        WHEN jsonb_typeof(${jsonValue}) = 'null' THEN '[]'::jsonb
        ELSE jsonb_build_array(${jsonValue})
      END)`;
    }
    return normalizeToJsonArray(expr.valueSql);
  }

  protected extractArrayScalarText(expr: SqlExpr): string {
    if (expr.storageKind === 'array' || expr.storageKind === 'json') {
      const normalized = this.normalizeArrayExpr(expr);

      // For lookup fields that are proxied to innerField, use the proxied valueType
      // to determine extraction logic. This avoids type checking in multiple places.
      if (this.isLookupArrayField(expr)) {
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
    return extractFirstJsonScalarText(expr.valueSql);
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
    const innerFieldType = this.getLookupInnerFieldType(expr);
    if (innerFieldType) {
      return this.stringifyLookupArrayExpr(normalized, innerFieldType, separator);
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
    innerFieldType: string,
    separator = ', '
  ): string {
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
      return this.stringifyNormalizedJsonArrayWithElement(
        normalizedJson,
        "(elem #>> '{}')::text",
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
      return this.stringifyNormalizedJsonArrayWithElement(
        normalizedJson,
        "elem #>> '{}'",
        separator
      );
    }

    // Boolean type: extract as text
    if (innerFieldType === 'checkbox') {
      return this.stringifyNormalizedJsonArrayWithElement(
        normalizedJson,
        "(CASE WHEN (elem #>> '{}')::boolean THEN 'true' ELSE 'false' END)",
        separator
      );
    }

    // Default: use generic extraction logic
    return stringifyNormalizedJsonArray(normalizedJson, separator);
  }

  protected unwrapArrayToScalar(expr: SqlExpr): SqlExpr {
    if (!expr.isArray) return expr;
    const scalarText = this.extractArrayScalarText(expr);
    const valueType =
      expr.valueType === 'number' || expr.valueType === 'boolean' || expr.valueType === 'datetime'
        ? expr.valueType
        : 'string';
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

  protected coerceToString(expr: SqlExpr): SqlExpr {
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
      const valueSql = this.isStructuredJsonField(expr)
        ? this.buildJsonObjectText(`(${expr.valueSql})::jsonb`)
        : extractJsonScalarText(expr.valueSql);
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
    const formattedSql = this.formatScalarForString(expr);
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

  protected formatScalarForString(expr: SqlExpr): string | undefined {
    const field = expr.field;
    if (!field) return undefined;
    const formatting = (field as { formatting?: () => unknown }).formatting?.();
    if (!formatting) return undefined;
    if (formatting instanceof NumberFormatting && expr.valueType === 'number') {
      return this.formatNumberString(expr.valueSql, formatting);
    }
    if (formatting instanceof DateTimeFormatting && expr.valueType === 'datetime') {
      return this.formatDatetimeString(expr.valueSql, formatting);
    }
    return undefined;
  }

  protected formatNumberString(valueSql: string, formatting: NumberFormatting): string {
    const precision = formatting.precision().toNumber();
    const decimalPart = precision > 0 ? `D${'0'.repeat(precision)}` : '';
    const mask = `FM999999990${decimalPart}`;
    const maskSql = sqlStringLiteral(mask);
    const baseValue = `(${valueSql})::numeric`;

    switch (formatting.type()) {
      case NumberFormattingType.Percent: {
        const percentValue = `(${baseValue} * 100)`;
        const formatted = `to_char(${percentValue}, ${maskSql})`;
        return `${formatted} || ${sqlStringLiteral('%')}`;
      }
      case NumberFormattingType.Currency: {
        const formatted = `to_char(${baseValue}, ${maskSql})`;
        return `${sqlStringLiteral(formatting.symbol() ?? '')} || ${formatted}`;
      }
      case NumberFormattingType.Decimal:
      default:
        return `to_char(${baseValue}, ${maskSql})`;
    }
  }

  protected formatDatetimeString(valueSql: string, formatting: DateTimeFormatting): string {
    const dateMask = this.mapDateFormatMask(formatting.date());
    const timeMask = this.mapTimeFormatMask(formatting.time());
    const fullMask = timeMask ? `${dateMask} ${timeMask}` : dateMask;
    const maskSql = sqlStringLiteral(fullMask);
    const tz = formatting.timeZone().toString();
    const zonedValue = `(${valueSql})::timestamptz AT TIME ZONE ${sqlStringLiteral(tz)}`;
    return `TO_CHAR(${zonedValue}, ${maskSql})`;
  }

  protected mapDateFormatMask(format: string): string {
    switch (format) {
      case 'M/D/YYYY':
        return 'FMMM/FMDD/YYYY';
      case 'D/M/YYYY':
        return 'FMDD/FMMM/YYYY';
      case 'YYYY/MM/DD':
        return 'YYYY/MM/DD';
      case 'YYYY-MM-DD':
        return 'YYYY-MM-DD';
      case 'YYYY-MM':
        return 'YYYY-MM';
      case 'MM-DD':
        return 'MM-DD';
      case 'YYYY':
        return 'YYYY';
      case 'MM':
        return 'MM';
      case 'DD':
        return 'DD';
      default:
        return 'YYYY-MM-DD';
    }
  }

  protected mapTimeFormatMask(format: TimeFormatting): string {
    switch (format) {
      case TimeFormatting.Hour24:
        return 'HH24:MI';
      case TimeFormatting.Hour12:
        return 'HH12:MI AM';
      case TimeFormatting.None:
      default:
        return '';
    }
  }

  protected coerceToBoolean(expr: SqlExpr): SqlExpr {
    const base = this.unwrapArrayToScalar(expr);
    if (base.valueType === 'boolean') return base;
    if (base.valueType === 'number') {
      const valueSql = `(CASE WHEN ${base.valueSql} IS NULL THEN NULL WHEN ${base.valueSql} <> 0 THEN TRUE ELSE FALSE END)`;
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
      WHEN ${textValue.valueSql} IS NULL THEN NULL
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
    const textSql = `(${textValue.valueSql})::text`;
    const validTimestamp = `pg_input_is_valid(${textSql}, 'timestamptz')`;
    const validTimestampNoTz = `pg_input_is_valid(${textSql}, 'timestamp')`;
    const valueSql = `(CASE
      WHEN ${textValue.valueSql} IS NULL THEN NULL::timestamptz
      WHEN ${validTimestamp} THEN (${textSql})::timestamptz
      WHEN ${validTimestampNoTz} THEN (${textSql})::timestamp::timestamptz
      ELSE NULL::timestamptz
    END)`;
    const errorCondition = `(${textValue.valueSql} IS NOT NULL AND NOT (${validTimestamp} OR ${validTimestampNoTz}))`;
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
    const leftText = this.coerceToString(left);
    const rightText = this.coerceToString(right);
    const leftNumeric = this.buildLooseNumericCast(leftText.valueSql);
    const rightNumeric = this.buildLooseNumericCast(rightText.valueSql);
    const numericCondition = `(${leftNumeric.castableSql} AND ${rightNumeric.castableSql})`;
    return `(CASE
      WHEN ${numericCondition} THEN (${leftNumeric.valueSql} ${operator} ${rightNumeric.valueSql})
      ELSE (${leftText.valueSql} ${operator} ${rightText.valueSql})
    END)`;
  }

  protected buildLooseDatetimeComparison(left: SqlExpr, right: SqlExpr, operator: string): string {
    const leftText = this.coerceToString(left);
    const rightText = this.coerceToString(right);
    const leftDatetime = this.buildLooseDatetimeCast(leftText.valueSql);
    const rightDatetime = this.buildLooseDatetimeCast(rightText.valueSql);
    const datetimeCondition = `(${leftDatetime.castableSql} AND ${rightDatetime.castableSql})`;
    return `(CASE
      WHEN ${datetimeCondition} THEN (${leftDatetime.valueSql} ${operator} ${rightDatetime.valueSql})
      ELSE (${leftText.valueSql} ${operator} ${rightText.valueSql})
    END)`;
  }

  protected buildLooseNumericCast(valueSql: string): {
    valueSql: string;
    castableSql: string;
    invalidSql: string;
  } {
    const numericPattern = sqlStringLiteral(
      // Intentionally disallow scientific notation (e.g. "3.7e+35") so that SUM/AVERAGE over
      // multi-value lookups can safely ignore such strings instead of coercing them into malformed numerics.
      '^[+-]?((\\d+\\.?\\d*)|(\\d*\\.\\d+))$'
    );
    const valueExpr = this.withValueAlias(valueSql, (ref) => {
      const textSql = `(${ref})::text`;
      const trimmed = `BTRIM(${textSql})`;
      const normalized = `NULLIF(REGEXP_REPLACE(${trimmed}, '[,\\s]', '', 'g'), '')`;
      const validNormalized = `(${normalized} ~ ${numericPattern} AND pg_input_is_valid(${normalized}, 'numeric'))`;
      return `(CASE
        WHEN ${normalized} IS NULL THEN NULL
        WHEN ${validNormalized} THEN (${normalized})::double precision
        ELSE NULL
      END)`;
    });
    const castableExpr = this.withValueAlias(valueSql, (ref) => {
      const textSql = `(${ref})::text`;
      const trimmed = `BTRIM(${textSql})`;
      const normalized = `NULLIF(REGEXP_REPLACE(${trimmed}, '[,\\s]', '', 'g'), '')`;
      const validNormalized = `(${normalized} ~ ${numericPattern} AND pg_input_is_valid(${normalized}, 'numeric'))`;
      return `(${normalized} IS NOT NULL AND ${validNormalized})`;
    });
    const invalidExpr = this.withValueAlias(valueSql, (ref) => {
      const textSql = `(${ref})::text`;
      const trimmed = `BTRIM(${textSql})`;
      const normalized = `NULLIF(REGEXP_REPLACE(${trimmed}, '[,\\s]', '', 'g'), '')`;
      const validNormalized = `(${normalized} ~ ${numericPattern} AND pg_input_is_valid(${normalized}, 'numeric'))`;
      return `(${normalized} IS NOT NULL AND NOT ${validNormalized})`;
    });
    return { valueSql: valueExpr, castableSql: castableExpr, invalidSql: invalidExpr };
  }

  protected buildLooseDatetimeCast(valueSql: string): { valueSql: string; castableSql: string } {
    const valueExpr = this.withValueAlias(valueSql, (ref) => {
      const textSql = `(${ref})::text`;
      const validTimestamp = `pg_input_is_valid(${textSql}, 'timestamptz')`;
      const validTimestampNoTz = `pg_input_is_valid(${textSql}, 'timestamp')`;
      return `(CASE
        WHEN ${validTimestamp} THEN (${textSql})::timestamptz
        WHEN ${validTimestampNoTz} THEN (${textSql})::timestamp
        ELSE NULL
      END)`;
    });
    const castableExpr = this.withValueAlias(valueSql, (ref) => {
      const textSql = `(${ref})::text`;
      return `(pg_input_is_valid(${textSql}, 'timestamptz') OR pg_input_is_valid(${textSql}, 'timestamp'))`;
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
    const jsonbBase = `${base}::jsonb`;
    const jsonbStringValue = `(${jsonbBase} #>> '{}')`;
    const jsonbStringTrimmed = `BTRIM(${jsonbStringValue})`;
    const jsonbStringLooksJson = `(LEFT(${jsonbStringTrimmed}, 1) IN ('[', '{'))`;
    const jsonbStringValid = `pg_input_is_valid(${jsonbStringValue}, 'jsonb')`;
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
    return `(CASE
      WHEN ${base} IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(${parsedJsonb}) = 'array' THEN ${parsedJsonb}
      WHEN jsonb_typeof(${parsedJsonb}) = 'null' THEN '[]'::jsonb
      ELSE jsonb_build_array(${parsedJsonb})
    END)`;
  }

  /**
   * Get the inner field type of a lookup field, if applicable.
   * Returns null if the field is not a lookup field or if the inner field is not resolved.
   */
  protected getLookupInnerFieldType(expr: SqlExpr): string | null {
    if (!expr.field) return null;
    const field = expr.field;

    // Check if field is a LookupField
    if (field.type().equals(FieldType.lookup())) {
      const lookupField = field as LookupField;
      const innerFieldResult = lookupField.innerField();
      if (innerFieldResult.isErr()) return null;
      const innerField = innerFieldResult.value;
      return innerField.type().toString();
    }

    if (field.type().equals(FieldType.conditionalLookup())) {
      const conditionalField = field as ConditionalLookupField;
      const innerFieldResult = conditionalField.innerField();
      if (innerFieldResult.isErr()) return null;
      const innerField = innerFieldResult.value;
      return innerField.type().toString();
    }

    return null;
  }

  protected isStructuredJsonField(expr: SqlExpr): boolean {
    const type = this.getFieldTypeName(expr);
    if (!type) return false;
    return JSON_OBJECT_FIELD_TYPES.has(type) || JSON_ARRAY_OBJECT_FIELD_TYPES.has(type);
  }

  protected isJsonArrayObjectField(expr: SqlExpr): boolean {
    const type = this.getFieldTypeName(expr);
    return Boolean(type && JSON_ARRAY_OBJECT_FIELD_TYPES.has(type));
  }

  protected isJsonArrayScalarField(expr: SqlExpr): boolean {
    const type = this.getFieldTypeName(expr);
    return Boolean(type && JSON_ARRAY_SCALAR_FIELD_TYPES.has(type));
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
      millisecond: `(${diffSeconds}) * 1000`,
      second: `(${diffSeconds})`,
      minute: `(${diffSeconds}) / 60`,
      hour: `(${diffSeconds}) / 3600`,
      day: `(${diffSeconds}) / 86400`,
      week: `(${diffSeconds}) / (86400 * 7)`,
      month: diffMonths,
      quarter: `(${diffMonths}) / 3.0`,
      year: diffYears,
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
      WHEN ${unitSql} IN ('millisecond', 'milliseconds') THEN (${diffSeconds}) * 1000
      WHEN ${unitSql} IN ('second', 'seconds') THEN (${diffSeconds})
      WHEN ${unitSql} IN ('minute', 'minutes') THEN (${diffSeconds}) / 60
      WHEN ${unitSql} IN ('hour', 'hours') THEN (${diffSeconds}) / 3600
      WHEN ${unitSql} IN ('week', 'weeks') THEN (${diffSeconds}) / (86400 * 7)
      WHEN ${unitSql} IN ('month', 'months') THEN ${diffMonths}
      WHEN ${unitSql} IN ('quarter', 'quarters') THEN (${diffMonths}) / 3.0
      WHEN ${unitSql} IN ('year', 'years') THEN ${diffYears}
      WHEN ${unitSql} IN ('day', 'days') THEN (${diffSeconds}) / 86400
      ELSE NULL::double precision
    END)`;
  }

  protected buildIsSameSql(unit: IsSameUnit, leftSql: string, rightSql: string): string {
    const sqlByUnit: Record<IsSameUnit, string> = {
      year: `DATE_TRUNC('year', ${leftSql}) = DATE_TRUNC('year', ${rightSql})`,
      month: `DATE_TRUNC('month', ${leftSql}) = DATE_TRUNC('month', ${rightSql})`,
      day: `DATE_TRUNC('day', ${leftSql}) = DATE_TRUNC('day', ${rightSql})`,
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

      const textLeft = this.coerceToString(left);
      const textRight = this.coerceToString(right);
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

    const type: SqlValueType = results[0]?.valueType ?? 'string';
    const isArray = results[0]?.isArray ?? false;
    const coerced = results.map((result) => result);

    if (results.every((result) => result.valueType === type && result.isArray === isArray)) {
      return { results: coerced, type, isArray, defaultValueSql: defaultResult?.valueSql };
    }

    const casted = results.map((result) => this.coerceToString(result));
    const defaultValueSql = defaultResult ? this.coerceToString(defaultResult).valueSql : undefined;
    return { results: casted, type: 'string', isArray: false, defaultValueSql };
  }
}
