/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable regexp/no-unused-capturing-group */
/* eslint-disable no-useless-escape */
import { DbFieldType } from '@teable/core';
import {
  buildAirtableDatetimeFormatSql,
  normalizeAirtableDatetimeFormatExpression,
} from '../../utils/datetime-format.util';
import { getDefaultDatetimeParsePattern } from '../../utils/default-datetime-parse-pattern';
import {
  isBooleanLikeParam,
  isDatetimeLikeParam,
  isJsonLikeParam,
  isTextLikeParam,
  isTrustedNumeric,
  resolveFormulaParamInfo,
} from '../../utils/formula-param-metadata.util';
import { GeneratedColumnQueryAbstract } from '../generated-column-query.abstract';

/**
 * PostgreSQL-specific implementation of generated column query functions
 * Converts Teable formula functions to PostgreSQL SQL expressions suitable
 * for use in generated columns. All generated SQL must be immutable.
 */
export class GeneratedColumnQueryPostgres extends GeneratedColumnQueryAbstract {
  private isEmptyStringLiteral(value: string): boolean {
    return value.trim() === "''";
  }

  private isNullLiteral(value: string): boolean {
    return this.stripOuterParentheses(value).toUpperCase() === 'NULL';
  }

  private shouldCoalesceNumericComparison(value: string, metadataIndex?: number): boolean {
    if (this.isNumericLiteral(value)) {
      return true;
    }
    const paramInfo = metadataIndex != null ? this.getParamInfo(metadataIndex) : undefined;
    return paramInfo ? isTrustedNumeric(paramInfo) || paramInfo.type === 'number' : false;
  }

  private normalizeNumericComparisonOperand(value: string, metadataIndex?: number): string {
    if (!this.shouldCoalesceNumericComparison(value, metadataIndex)) {
      return value;
    }
    return this.collapseNumeric(value, metadataIndex);
  }

  private hasWrappingParentheses(expr: string): boolean {
    if (!expr.startsWith('(') || !expr.endsWith(')')) {
      return false;
    }
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0 && i < expr.length - 1) {
          return false;
        }
        if (depth < 0) {
          return false;
        }
      }
    }
    return depth === 0;
  }

  private stripOuterParentheses(expr: string): string {
    let trimmed = expr.trim();
    while (trimmed.length > 0 && this.hasWrappingParentheses(trimmed)) {
      trimmed = trimmed.slice(1, -1).trim();
    }
    return trimmed;
  }

  private getParamInfo(index?: number) {
    return resolveFormulaParamInfo(this.currentCallMetadata, index);
  }

  private isNumericLiteral(expr: string): boolean {
    let trimmed = this.stripOuterParentheses(expr);

    // Peel leading signs while trimming redundant outer parens
    while (trimmed.startsWith('+') || trimmed.startsWith('-')) {
      trimmed = trimmed.slice(1).trim();
      trimmed = this.stripOuterParentheses(trimmed);
    }

    // Match plain numeric literal, with optional cast to a numeric type
    const numericWithOptionalCast =
      /^\(?\d+(\.\d+)?\)?(::(double precision|numeric|real|integer|bigint|smallint))?$/i;
    if (numericWithOptionalCast.test(trimmed)) {
      return true;
    }

    // Handle wrapped casts like ((7)::double precision)
    const wrappedCastMatch = trimmed.match(/^\((.+)\)$/);
    if (wrappedCastMatch) {
      return this.isNumericLiteral(wrappedCastMatch[1]);
    }

    return false;
  }

  private toNumericSafe(expr: string, metadataIndex?: number): string {
    if (this.isNumericLiteral(expr)) {
      return `(${expr})::double precision`;
    }
    const paramInfo = this.getParamInfo(metadataIndex);
    const expressionFieldType = this.getExpressionFieldType(expr);
    if (isBooleanLikeParam(paramInfo)) {
      const normalizedBoolean = this.normalizeBooleanCondition(expr, metadataIndex ?? 0);
      return `(CASE WHEN ${normalizedBoolean} THEN 1 ELSE 0 END)::double precision`;
    }
    if (
      paramInfo?.hasMetadata &&
      isTextLikeParam(paramInfo) &&
      !paramInfo.isJsonField &&
      !paramInfo.isMultiValueField
    ) {
      return this.looseNumericCoercion(expr);
    }
    if (expressionFieldType === DbFieldType.Text) {
      return this.looseNumericCoercion(expr);
    }
    if (paramInfo?.isJsonField || paramInfo?.isMultiValueField) {
      return this.numericFromJson(expr);
    }
    if (expressionFieldType === DbFieldType.Json) {
      return this.numericFromJson(expr);
    }
    if (isTrustedNumeric(paramInfo)) {
      return `(${expr})::double precision`;
    }
    if (
      !paramInfo?.hasMetadata &&
      (expressionFieldType === DbFieldType.Real || expressionFieldType === DbFieldType.Integer)
    ) {
      return `(${expr})::double precision`;
    }

    if (!paramInfo && expressionFieldType === undefined) {
      return `(${expr})::double precision`;
    }

    return this.looseNumericCoercion(expr);
  }

  private looseNumericCoercion(expr: string): string {
    if (this.isNumericLiteral(expr)) {
      return `(${expr})::double precision`;
    }
    const textExpr = `((${expr})::text) COLLATE "C"`;
    const dateLikePattern = `'^[0-9]{1,4}[-/][0-9]{1,2}[-/][0-9]{1,4}( .*){0,1}$'`;
    const collatedDatePattern = `${dateLikePattern} COLLATE "C"`;
    const sanitized = `REGEXP_REPLACE(${textExpr}, '[^0-9.+-]', '', 'g')`;
    const cleaned = `NULLIF(${sanitized}, '')`;
    const collatedClean = `${cleaned} COLLATE "C"`;
    // Avoid "?" in the regex so knex.raw doesn't misinterpret it as a binding placeholder.
    const numericPattern = `'^[+-]{0,1}(\\d+(\\.\\d+){0,1}|\\.\\d+)$'`;
    const collatedPattern = `${numericPattern} COLLATE "C"`;
    return `(CASE
      WHEN ${expr} IS NULL THEN NULL
      WHEN ${textExpr} ~ ${collatedDatePattern} THEN NULL
      WHEN ${cleaned} IS NULL THEN NULL
      WHEN ${collatedClean} ~ ${collatedPattern} THEN ${cleaned}::double precision
      ELSE NULL
    END)`;
  }

  private numericFromJson(expr: string): string {
    const jsonExpr = `to_jsonb(${expr})`;
    const numericPattern = `'^[+-]{0,1}(\\d+(\\.\\d+){0,1}|\\.\\d+)$'`;
    const collatedPattern = `${numericPattern} COLLATE "C"`;
    const arraySum = `(SELECT SUM(CASE WHEN (elem.value COLLATE "C") ~ ${collatedPattern} THEN elem.value::double precision ELSE NULL END) FROM jsonb_array_elements_text(${jsonExpr}) AS elem(value))`;
    return `(CASE
      WHEN ${expr} IS NULL THEN NULL
      WHEN jsonb_typeof(${jsonExpr}) = 'array' THEN ${arraySum}
      ELSE ${this.looseNumericCoercion(expr)}
    END)`;
  }

  private numericFromText(expr: string): string {
    const textExpr = `((${expr})::text) COLLATE "C"`;
    const numericPattern = `'^[+-]{0,1}(\\d+(\\.\\d+){0,1}|\\.\\d+)$'`;
    const collatedPattern = `${numericPattern} COLLATE "C"`;
    return `(CASE
      WHEN ${expr} IS NULL THEN NULL
      WHEN ${textExpr} ~ ${collatedPattern} THEN ${textExpr}::double precision
      ELSE NULL
    END)`;
  }

  private collapseNumeric(expr: string, metadataIndex?: number): string {
    const numericValue = this.toNumericSafe(expr, metadataIndex);
    return `COALESCE(${numericValue}, 0)`;
  }

  private normalizeBlankComparable(value: string, metadataIndex?: number): string {
    const comparable = this.coerceToTextComparable(value, metadataIndex);
    return `COALESCE(NULLIF(${comparable}, ''), '')`;
  }

  private ensureTextCollation(expr: string): string {
    return `(${expr})::text`;
  }

  private buildBlankAwareComparison(
    operator: '=' | '<>',
    left: string,
    right: string,
    metadataIndexes?: { left?: number; right?: number }
  ): string {
    const leftIndex = metadataIndexes?.left;
    const rightIndex = metadataIndexes?.right;
    const leftIsEmptyLiteral = this.isEmptyStringLiteral(left);
    const rightIsEmptyLiteral = this.isEmptyStringLiteral(right);
    const leftIsText = this.isTextLikeExpression(left, leftIndex);
    const rightIsText = this.isTextLikeExpression(right, rightIndex);
    const normalizeText = leftIsEmptyLiteral || rightIsEmptyLiteral || leftIsText || rightIsText;

    const leftIsNumericComparable = this.shouldCoalesceNumericComparison(left, leftIndex);
    const rightIsNumericComparable = this.shouldCoalesceNumericComparison(right, rightIndex);

    if (!normalizeText && (leftIsNumericComparable || rightIsNumericComparable)) {
      const normalizedLeft = leftIsNumericComparable
        ? this.normalizeNumericComparisonOperand(left, leftIndex)
        : left;
      const normalizedRight = rightIsNumericComparable
        ? this.normalizeNumericComparisonOperand(right, rightIndex)
        : right;
      return `(${normalizedLeft} ${operator} ${normalizedRight})`;
    }

    if (!normalizeText) {
      return `(${left} ${operator} ${right})`;
    }

    const normalizeOperand = (value: string, isEmptyLiteral: boolean, metadataIndex?: number) =>
      isEmptyLiteral ? "''" : this.normalizeBlankComparable(value, metadataIndex);

    const normalizedLeft = normalizeOperand(left, leftIsEmptyLiteral, leftIndex);
    const normalizedRight = normalizeOperand(right, rightIsEmptyLiteral, rightIndex);

    return `(${normalizedLeft} ${operator} ${normalizedRight})`;
  }

  private isTextLikeExpression(value: string, metadataIndex?: number): boolean {
    const trimmed = this.stripOuterParentheses(value);
    if (this.isEmptyStringLiteral(trimmed)) {
      return false;
    }
    if (/^'.*'$/.test(trimmed)) {
      return true;
    }

    const paramInfo = metadataIndex != null ? this.getParamInfo(metadataIndex) : undefined;
    if (paramInfo?.hasMetadata) {
      if (
        paramInfo.fieldDbType === DbFieldType.Real ||
        paramInfo.fieldDbType === DbFieldType.Integer ||
        paramInfo.fieldCellValueType === 'number'
      ) {
        return false;
      }
      if (isTextLikeParam(paramInfo)) {
        return true;
      }
    }

    return this.getExpressionFieldType(value) === DbFieldType.Text;
  }

  private isNumericLikeExpression(value: string, metadataIndex?: number): boolean {
    if (this.isNumericLiteral(value)) {
      return true;
    }

    const paramInfo = metadataIndex != null ? this.getParamInfo(metadataIndex) : undefined;
    if (paramInfo?.hasMetadata) {
      if (
        paramInfo.type === 'number' ||
        isTrustedNumeric(paramInfo) ||
        isBooleanLikeParam(paramInfo)
      ) {
        return true;
      }
      if (
        paramInfo.fieldDbType === DbFieldType.Real ||
        paramInfo.fieldDbType === DbFieldType.Integer
      ) {
        return true;
      }
      if (paramInfo.fieldCellValueType === 'number') {
        return true;
      }
    }

    const expressionFieldType = this.getExpressionFieldType(value);
    return expressionFieldType === DbFieldType.Real || expressionFieldType === DbFieldType.Integer;
  }

  private getExpressionFieldType(value: string): DbFieldType | undefined {
    const trimmed = this.stripOuterParentheses(value);
    const columnMatch = trimmed.match(/^"([^"]+)"$/) ?? trimmed.match(/^"[^"]+"\."([^"]+)"$/);
    if (!columnMatch || columnMatch.length < 2) {
      return undefined;
    }

    const columnName = columnMatch[1];
    const table = this.context?.table;
    const field =
      table?.fieldList?.find((item) => item.dbFieldName === columnName) ??
      table?.fields?.ordered?.find((item) => item.dbFieldName === columnName);
    return field?.dbFieldType as DbFieldType | undefined;
  }

  private buildJsonScalarCoercion(jsonExpr: string): string {
    const elementScalar = `CASE
      WHEN jsonb_typeof(elem.value) = 'object' THEN COALESCE(
        elem.value->>'title',
        elem.value->>'name',
        elem.value #>> '{}'
      )
      WHEN jsonb_typeof(elem.value) = 'array' THEN NULL
      ELSE elem.value #>> '{}'
    END`;

    return `CASE jsonb_typeof(${jsonExpr})
      WHEN 'string' THEN (${jsonExpr}) #>> '{}'
      WHEN 'number' THEN (${jsonExpr}) #>> '{}'
      WHEN 'boolean' THEN (${jsonExpr}) #>> '{}'
      WHEN 'null' THEN NULL
      WHEN 'array' THEN COALESCE((
        SELECT STRING_AGG(${elementScalar}, ', ' ORDER BY elem.ordinality)
        FROM jsonb_array_elements(${jsonExpr}) WITH ORDINALITY AS elem(value, ordinality)
      ), '')
      WHEN 'object' THEN COALESCE(${jsonExpr}->>'title', ${jsonExpr}->>'name', ${jsonExpr} #>> '{}')
      ELSE (${jsonExpr})::text
    END`;
  }

  private coerceJsonExpressionToText(wrapped: string): string {
    const doubleWrapped = `(${wrapped})`;
    const directJsonExpr = `${doubleWrapped}::jsonb`;
    const fallbackJsonExpr = `to_jsonb${wrapped}`;
    const jsonTypeGuard = `pg_typeof(${wrapped}) = ANY('{json,jsonb}'::regtype[])`;

    return `(CASE
      WHEN ${wrapped} IS NULL THEN NULL
      WHEN ${jsonTypeGuard} THEN
        ${this.buildJsonScalarCoercion(directJsonExpr)}
      ELSE
        ${this.buildJsonScalarCoercion(fallbackJsonExpr)}
    END)`;
  }

  private coerceNonJsonExpressionToText(wrapped: string): string {
    const jsonbValue = `to_jsonb${wrapped}`;

    return `(CASE
      WHEN ${wrapped} IS NULL THEN NULL
      ELSE
        ${this.buildJsonScalarCoercion(jsonbValue)}
    END)`;
  }

  private coerceToTextComparable(value: string, metadataIndex?: number): string {
    const trimmed = this.stripOuterParentheses(value);
    if (!trimmed) {
      return this.ensureTextCollation(value);
    }
    if (/^'.*'$/.test(trimmed)) {
      return this.ensureTextCollation(trimmed);
    }
    if (trimmed.toUpperCase() === 'NULL') {
      return 'NULL';
    }

    const wrapped = `(${value})`;
    const paramInfo = metadataIndex != null ? this.getParamInfo(metadataIndex) : undefined;
    const expressionFieldType = this.getExpressionFieldType(value);
    const numericField =
      paramInfo?.fieldDbType === DbFieldType.Real ||
      paramInfo?.fieldDbType === DbFieldType.Integer ||
      paramInfo?.fieldCellValueType === 'number' ||
      expressionFieldType === DbFieldType.Real ||
      expressionFieldType === DbFieldType.Integer;
    if (numericField && !paramInfo?.isJsonField && !paramInfo?.isMultiValueField) {
      return wrapped;
    }
    const isJsonParam = paramInfo?.hasMetadata && isJsonLikeParam(paramInfo);
    const shouldUseSimpleCast =
      this.isGeneratedColumnContext &&
      !isJsonParam &&
      !paramInfo?.isMultiValueField &&
      expressionFieldType !== DbFieldType.Json;

    if (paramInfo?.hasMetadata) {
      if (isJsonParam) {
        if (shouldUseSimpleCast) {
          return this.ensureTextCollation(`${wrapped}::text`);
        }
        const coercedJson = this.coerceJsonExpressionToText(wrapped);
        return this.ensureTextCollation(coercedJson);
      }

      if (isTextLikeParam(paramInfo)) {
        return this.ensureTextCollation(value);
      }

      if (paramInfo.type && paramInfo.type !== 'unknown') {
        return this.ensureTextCollation(`${wrapped}::text`);
      }
    }

    if (expressionFieldType === DbFieldType.Json) {
      if (shouldUseSimpleCast) {
        return this.ensureTextCollation(`${wrapped}::text`);
      }
      const coercedJson = this.coerceJsonExpressionToText(wrapped);
      return this.ensureTextCollation(coercedJson);
    }

    if (expressionFieldType === DbFieldType.Text) {
      return this.ensureTextCollation(value);
    }

    if (shouldUseSimpleCast) {
      return this.ensureTextCollation(`${wrapped}::text`);
    }

    const coerced = this.coerceNonJsonExpressionToText(wrapped);
    return this.ensureTextCollation(coerced);
  }

  private isHardTextExpression(value: string): boolean {
    const trimmed = this.stripOuterParentheses(value);
    if (this.isEmptyStringLiteral(trimmed)) {
      return false;
    }
    if (/^'.+'$/.test(trimmed)) {
      return true;
    }
    return this.getExpressionFieldType(value) === DbFieldType.Text;
  }

  private isDateLikeOperand(metadataIndex?: number): boolean {
    const paramInfo = metadataIndex != null ? this.getParamInfo(metadataIndex) : undefined;
    if (!paramInfo?.hasMetadata) {
      return false;
    }
    if (paramInfo.type === 'number') {
      return false;
    }
    const hasFieldDateMetadata =
      paramInfo.fieldDbType === DbFieldType.DateTime || paramInfo.fieldCellValueType === 'datetime';
    const typeSaysDatetime =
      isDatetimeLikeParam(paramInfo) && !paramInfo.fieldDbType && !paramInfo.fieldCellValueType;
    const looksDatetime = hasFieldDateMetadata || typeSaysDatetime;

    if (!looksDatetime) {
      return false;
    }

    return !paramInfo.isJsonField && !paramInfo.isMultiValueField;
  }

  private buildDayInterval(expr: string, metadataIndex?: number): string {
    const numeric = this.collapseNumeric(expr, metadataIndex);
    return `(${numeric}) * INTERVAL '1 day'`;
  }

  private countANonNullExpression(value: string, metadataIndex?: number): string {
    if (this.isTextLikeExpression(value, metadataIndex)) {
      const normalizedComparable = this.normalizeBlankComparable(value, metadataIndex);
      return `CASE WHEN ${value} IS NULL OR ${normalizedComparable} = '' THEN 0 ELSE 1 END`;
    }

    return `CASE WHEN ${value} IS NULL THEN 0 ELSE 1 END`;
  }

  override add(left: string, right: string): string {
    const leftIsDate = this.isDateLikeOperand(0);
    const rightIsDate = this.isDateLikeOperand(1);

    if (leftIsDate && !rightIsDate) {
      return `(${this.castToTimestamp(left, 0)} + ${this.buildDayInterval(right, 1)})`;
    }

    if (!leftIsDate && rightIsDate) {
      return `(${this.castToTimestamp(right, 1)} + ${this.buildDayInterval(left, 0)})`;
    }

    const l = this.collapseNumeric(left, 0);
    const r = this.collapseNumeric(right, 1);
    return `((${l}) + (${r}))`;
  }

  override subtract(left: string, right: string): string {
    const leftIsDate = this.isDateLikeOperand(0);
    const rightIsDate = this.isDateLikeOperand(1);

    if (leftIsDate && !rightIsDate) {
      return `(${this.castToTimestamp(left, 0)} - ${this.buildDayInterval(right, 1)})`;
    }

    if (leftIsDate && rightIsDate) {
      return `(EXTRACT(EPOCH FROM ${this.castToTimestamp(left, 0)} - ${this.castToTimestamp(
        right,
        1
      )}) / 86400)`;
    }

    const l = this.collapseNumeric(left, 0);
    const r = this.collapseNumeric(right, 1);
    return `((${l}) - (${r}))`;
  }

  override multiply(left: string, right: string): string {
    const l = this.collapseNumeric(left, 0);
    const r = this.collapseNumeric(right, 1);
    return `((${l}) * (${r}))`;
  }

  override unaryMinus(value: string): string {
    const numericValue = this.toNumericSafe(value, 0);
    return `(-(${numericValue}))`;
  }

  override divide(left: string, right: string): string {
    const numerator = this.collapseNumeric(left, 0);
    const denominator = this.toNumericSafe(right, 1);
    return `(CASE WHEN (${denominator}) IS NULL OR (${denominator}) = 0 THEN NULL ELSE (${numerator} / ${denominator}) END)`;
  }

  override modulo(left: string, right: string): string {
    const dividend = this.collapseNumeric(left, 0);
    const divisor = this.toNumericSafe(right, 1);
    return `(CASE WHEN (${divisor}) IS NULL OR (${divisor}) = 0 THEN NULL ELSE MOD((${dividend})::numeric, (${divisor})::numeric)::double precision END)`;
  }

  private isBooleanLikeExpression(value: string, metadataIndex?: number): boolean {
    const trimmed = this.stripOuterParentheses(value);
    if (/^(true|false)$/i.test(trimmed)) {
      return true;
    }

    const paramInfo = metadataIndex != null ? this.getParamInfo(metadataIndex) : undefined;
    if (paramInfo?.hasMetadata && isBooleanLikeParam(paramInfo)) {
      return true;
    }

    return this.getExpressionFieldType(value) === DbFieldType.Boolean;
  }

  private normalizeBooleanCondition(condition: string, metadataIndex = 0): string {
    const wrapped = `(${condition})`;
    if (this.isBooleanLikeExpression(condition, metadataIndex)) {
      return `COALESCE(${wrapped}::boolean, FALSE)`;
    }

    const paramInfo = this.getParamInfo(metadataIndex);
    if (isTrustedNumeric(paramInfo)) {
      const numericExpr = this.toNumericSafe(condition, metadataIndex);
      return `(COALESCE(${numericExpr}, 0) <> 0)`;
    }

    const conditionType = `pg_typeof${wrapped}::text`;
    const numericTypes = "('smallint','integer','bigint','numeric','double precision','real')";
    const stringTypes = "('text','character varying','character','varchar','unknown')";
    const wrappedText = `(${wrapped})::text`;
    const booleanTruthyScore = `CASE WHEN LOWER(${wrappedText}) IN ('t','true','1') THEN 1 ELSE 0 END`;
    const numericTruthyScore = `CASE WHEN ${wrappedText} ~ '^\\s*[+-]{0,1}0*(\\.0*){0,1}\\s*$' THEN 0 ELSE 1 END`;
    const fallbackTruthyScore = `CASE
      WHEN COALESCE(${wrappedText}, '') = '' THEN 0
      WHEN LOWER(${wrappedText}) = 'null' THEN 0
      ELSE 1
    END`;

    return `CASE
      WHEN ${wrapped} IS NULL THEN 0
      WHEN ${conditionType} = 'boolean' THEN ${booleanTruthyScore}
      WHEN ${conditionType} IN ${numericTypes} THEN ${numericTruthyScore}
      WHEN ${conditionType} IN ${stringTypes} THEN ${fallbackTruthyScore}
      ELSE ${fallbackTruthyScore}
    END = 1`;
  }

  // Numeric Functions
  sum(params: string[]): string {
    // Use addition instead of SUM() aggregation function for generated columns
    const numericParams = params.map((param, index) => `(${this.collapseNumeric(param, index)})`);
    return `(${numericParams.join(' + ')})`;
  }

  average(params: string[]): string {
    // Use addition and division instead of AVG() aggregation function for generated columns
    const numericParams = params.map((param, index) => `(${this.collapseNumeric(param, index)})`);
    return `(${numericParams.join(' + ')}) / ${params.length}`;
  }

  max(params: string[]): string {
    return `GREATEST(${this.joinParams(params)})`;
  }

  min(params: string[]): string {
    return `LEAST(${this.joinParams(params)})`;
  }

  round(value: string, precision?: string): string {
    const numericValue = this.toNumericSafe(value, 0);
    if (precision !== undefined) {
      const numericPrecision = this.toNumericSafe(precision, 1);
      return `ROUND(${numericValue}::numeric, ${numericPrecision}::integer)`;
    }
    return `ROUND(${numericValue})`;
  }

  roundUp(value: string, precision?: string): string {
    const numericValue = this.toNumericSafe(value, 0);
    if (precision !== undefined) {
      const numericPrecision = this.toNumericSafe(precision, 1);
      const factor = `POWER(10, ${numericPrecision}::integer)`;
      return `CEIL(${numericValue} * ${factor}) / ${factor}`;
    }
    return `CEIL(${numericValue})`;
  }

  roundDown(value: string, precision?: string): string {
    const numericValue = this.toNumericSafe(value, 0);
    if (precision !== undefined) {
      const numericPrecision = this.toNumericSafe(precision, 1);
      const factor = `POWER(10, ${numericPrecision}::integer)`;
      return `FLOOR(${numericValue} * ${factor}) / ${factor}`;
    }
    return `FLOOR(${numericValue})`;
  }

  ceiling(value: string): string {
    return `CEIL(${this.toNumericSafe(value, 0)})`;
  }

  floor(value: string): string {
    return `FLOOR(${this.toNumericSafe(value, 0)})`;
  }

  even(value: string): string {
    const numericValue = this.toNumericSafe(value, 0);
    const intValue = `FLOOR(${numericValue})::integer`;
    return `CASE WHEN ${numericValue} IS NULL THEN NULL WHEN ${intValue} % 2 = 0 THEN ${intValue} ELSE ${intValue} + 1 END`;
  }

  odd(value: string): string {
    const numericValue = this.toNumericSafe(value, 0);
    const intValue = `FLOOR(${numericValue})::integer`;
    return `CASE WHEN ${numericValue} IS NULL THEN NULL WHEN ${intValue} % 2 = 1 THEN ${intValue} ELSE ${intValue} + 1 END`;
  }

  int(value: string): string {
    return `FLOOR(${this.toNumericSafe(value, 0)})`;
  }

  abs(value: string): string {
    return `ABS(${this.toNumericSafe(value, 0)})`;
  }

  sqrt(value: string): string {
    return `SQRT(${this.toNumericSafe(value, 0)})`;
  }

  power(base: string, exponent: string): string {
    const baseValue = this.toNumericSafe(base, 0);
    const exponentValue = this.toNumericSafe(exponent, 1);
    return `POWER(${baseValue}, ${exponentValue})`;
  }

  exp(value: string): string {
    return `EXP(${this.toNumericSafe(value, 0)})`;
  }

  log(value: string, base?: string): string {
    const numericValue = this.toNumericSafe(value, 0);
    if (base !== undefined) {
      const numericBase = this.toNumericSafe(base, 1);
      const baseLog = `LN(${numericBase})`;
      return `(LN(${numericValue}) / NULLIF(${baseLog}, 0))`;
    }
    return `LN(${numericValue})`;
  }

  mod(dividend: string, divisor: string): string {
    const safeDividend = this.toNumericSafe(dividend, 0);
    const safeDivisor = this.toNumericSafe(divisor, 1);
    return `(CASE WHEN (${safeDivisor}) IS NULL OR (${safeDivisor}) = 0 THEN NULL ELSE MOD((${safeDividend})::numeric, (${safeDivisor})::numeric)::double precision END)`;
  }

  value(text: string): string {
    return this.toNumericSafe(text, 0);
  }

  // Text Functions
  concatenate(params: string[]): string {
    // Use || operator instead of CONCAT for immutable generated columns
    // CONCAT is stable, not immutable, which causes issues with generated columns
    // Treat NULL values as empty strings to mirror client-side evaluation
    const nullSafeParams = params.map((param) => `COALESCE(${param}::text, '')`);
    return `(${this.joinParams(nullSafeParams, ' || ')})`;
  }

  // String concatenation for + operator (treats NULL as empty string)
  // Use explicit text casting to handle mixed types and NULL values
  stringConcat(left: string, right: string): string {
    return `(COALESCE(${left}::text, '') || COALESCE(${right}::text, ''))`;
  }

  equal(left: string, right: string): string {
    return this.buildBlankAwareComparison('=', left, right, { left: 0, right: 1 });
  }

  notEqual(left: string, right: string): string {
    return this.buildBlankAwareComparison('<>', left, right, { left: 0, right: 1 });
  }

  greaterThan(left: string, right: string): string {
    const normalizedLeft = this.normalizeNumericComparisonOperand(left, 0);
    const normalizedRight = this.normalizeNumericComparisonOperand(right, 1);
    return `(${normalizedLeft} > ${normalizedRight})`;
  }

  lessThan(left: string, right: string): string {
    const normalizedLeft = this.normalizeNumericComparisonOperand(left, 0);
    const normalizedRight = this.normalizeNumericComparisonOperand(right, 1);
    return `(${normalizedLeft} < ${normalizedRight})`;
  }

  greaterThanOrEqual(left: string, right: string): string {
    const normalizedLeft = this.normalizeNumericComparisonOperand(left, 0);
    const normalizedRight = this.normalizeNumericComparisonOperand(right, 1);
    return `(${normalizedLeft} >= ${normalizedRight})`;
  }

  lessThanOrEqual(left: string, right: string): string {
    const normalizedLeft = this.normalizeNumericComparisonOperand(left, 0);
    const normalizedRight = this.normalizeNumericComparisonOperand(right, 1);
    return `(${normalizedLeft} <= ${normalizedRight})`;
  }

  // Override bitwiseAnd to handle PostgreSQL-specific type conversion
  bitwiseAnd(left: string, right: string): string {
    // Handle cases where operands might not be valid integers
    // Use CASE to safely convert to integer, defaulting to 0 for invalid values
    return `(
      CASE
        WHEN ${left}::text ~ '^-?[0-9]+$' AND ${left}::text != '' THEN ${left}::integer
        ELSE 0
      END &
      CASE
        WHEN ${right}::text ~ '^-?[0-9]+$' AND ${right}::text != '' THEN ${right}::integer
        ELSE 0
      END
    )`;
  }

  find(searchText: string, withinText: string, startNum?: string): string {
    const normalizedSearch = this.ensureTextCollation(searchText);
    const normalizedWithin = this.ensureTextCollation(withinText);

    if (startNum) {
      return `POSITION(${normalizedSearch} IN SUBSTRING(${normalizedWithin} FROM ${startNum}::integer)) + ${startNum}::integer - 1`;
    }
    return `POSITION(${normalizedSearch} IN ${normalizedWithin})`;
  }

  search(searchText: string, withinText: string, startNum?: string): string {
    const normalizedSearch = this.ensureTextCollation(searchText);
    const normalizedWithin = this.ensureTextCollation(withinText);

    // PostgreSQL doesn't have case-insensitive POSITION, so we use ILIKE with pattern matching
    if (startNum) {
      return `POSITION(UPPER(${normalizedSearch}) IN UPPER(SUBSTRING(${normalizedWithin} FROM ${startNum}::integer))) + ${startNum}::integer - 1`;
    }
    return `POSITION(UPPER(${normalizedSearch}) IN UPPER(${normalizedWithin}))`;
  }

  mid(text: string, startNum: string, numChars: string): string {
    return `SUBSTRING((${text})::text FROM ${startNum}::integer FOR ${numChars}::integer)`;
  }

  left(text: string, numChars: string): string {
    return `LEFT((${text})::text, ${numChars}::integer)`;
  }

  right(text: string, numChars: string): string {
    return `RIGHT((${text})::text, ${numChars}::integer)`;
  }

  replace(oldText: string, startNum: string, numChars: string, newText: string): string {
    const source = this.ensureTextCollation(oldText);
    const replacement = this.ensureTextCollation(newText);
    return `OVERLAY(${source} PLACING ${replacement} FROM ${startNum}::integer FOR ${numChars}::integer)`;
  }

  regexpReplace(text: string, pattern: string, replacement: string): string {
    const source = this.ensureTextCollation(text);
    const regex = this.ensureTextCollation(pattern);
    const replacementText = this.ensureTextCollation(replacement);
    return `REGEXP_REPLACE(${source}, ${regex}, ${replacementText}, 'g')`;
  }

  substitute(text: string, oldText: string, newText: string, instanceNum?: string): string {
    const source = this.ensureTextCollation(this.coerceToTextComparable(text, 0));
    const search = this.ensureTextCollation(this.coerceToTextComparable(oldText, 1));
    const replacement = this.ensureTextCollation(this.coerceToTextComparable(newText, 2));
    if (instanceNum) {
      // PostgreSQL doesn't have direct support for replacing specific instance
      // This is a simplified implementation
      return `REPLACE(${source}, ${search}, ${replacement})`;
    }
    return `REPLACE(${source}, ${search}, ${replacement})`;
  }

  lower(text: string): string {
    const operand = this.coerceToTextComparable(text, 0);
    return `LOWER(${operand})`;
  }

  upper(text: string): string {
    const operand = this.coerceToTextComparable(text, 0);
    return `UPPER(${operand})`;
  }

  rept(text: string, numTimes: string): string {
    const operand = this.coerceToTextComparable(text, 0);
    return `REPEAT(${operand}, ${numTimes}::integer)`;
  }

  trim(text: string): string {
    const operand = this.coerceToTextComparable(text, 0);
    return `TRIM(${operand})`;
  }

  len(text: string): string {
    // Force text to prevent LENGTH() from receiving numeric/JSON operands (e.g., auto-number)
    const operand = this.ensureTextCollation(this.coerceToTextComparable(text, 0));
    return `LENGTH(${operand})`;
  }

  t(value: string): string {
    return `CASE WHEN ${value} IS NULL THEN '' ELSE ${value}::text END`;
  }

  encodeUrlComponent(text: string): string {
    // PostgreSQL doesn't have built-in URL encoding, this would need a custom function
    return `encode(${text}::bytea, 'escape')`;
  }

  // DateTime Functions
  now(): string {
    // For generated columns, use the current timestamp at field creation time
    if (this.isGeneratedColumnContext) {
      const currentTimestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
      return `'${currentTimestamp}'::timestamp`;
    }
    return 'NOW()';
  }

  today(): string {
    // For generated columns, use the current date at field creation time
    if (this.isGeneratedColumnContext) {
      const currentDate = new Date().toISOString().split('T')[0];
      return `'${currentDate}'::date`;
    }
    return 'CURRENT_DATE';
  }

  private normalizeIntervalUnit(
    unitLiteral: string,
    options?: { treatQuarterAsMonth?: boolean }
  ): {
    unit:
      | 'millisecond'
      | 'second'
      | 'minute'
      | 'hour'
      | 'day'
      | 'week'
      | 'month'
      | 'quarter'
      | 'year';
    factor: number;
  } {
    const normalized = unitLiteral.trim().toLowerCase();
    switch (normalized) {
      case 'millisecond':
      case 'milliseconds':
      case 'ms':
        return { unit: 'millisecond', factor: 1 };
      case 'second':
      case 'seconds':
      case 's':
      case 'sec':
      case 'secs':
        return { unit: 'second', factor: 1 };
      case 'minute':
      case 'minutes':
      case 'min':
      case 'mins':
        return { unit: 'minute', factor: 1 };
      case 'hour':
      case 'hours':
      case 'h':
      case 'hr':
      case 'hrs':
        return { unit: 'hour', factor: 1 };
      case 'week':
      case 'weeks':
        return { unit: 'week', factor: 1 };
      case 'month':
      case 'months':
        return { unit: 'month', factor: 1 };
      case 'quarter':
      case 'quarters':
        if (options?.treatQuarterAsMonth === false) {
          return { unit: 'quarter', factor: 1 };
        }
        return { unit: 'month', factor: 3 };
      case 'year':
      case 'years':
        return { unit: 'year', factor: 1 };
      case 'day':
      case 'days':
      default:
        return { unit: 'day', factor: 1 };
    }
  }

  private normalizeDiffUnit(
    unitLiteral: string
  ): 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year' {
    const normalized = unitLiteral.trim().toLowerCase();
    switch (normalized) {
      case 'millisecond':
      case 'milliseconds':
      case 'ms':
        return 'millisecond';
      case 'second':
      case 'seconds':
      case 's':
      case 'sec':
      case 'secs':
        return 'second';
      case 'minute':
      case 'minutes':
      case 'min':
      case 'mins':
        return 'minute';
      case 'hour':
      case 'hours':
      case 'h':
      case 'hr':
      case 'hrs':
        return 'hour';
      case 'week':
      case 'weeks':
        return 'week';
      case 'month':
      case 'months':
        return 'month';
      case 'quarter':
      case 'quarters':
        return 'quarter';
      case 'year':
      case 'years':
        return 'year';
      default:
        return 'day';
    }
  }

  private normalizeTruncateUnit(
    unitLiteral: string
  ): 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year' {
    const normalized = unitLiteral.trim().toLowerCase();
    switch (normalized) {
      case 'millisecond':
      case 'milliseconds':
      case 'ms':
        return 'millisecond';
      case 'second':
      case 'seconds':
      case 's':
      case 'sec':
      case 'secs':
        return 'second';
      case 'minute':
      case 'minutes':
      case 'min':
      case 'mins':
        return 'minute';
      case 'hour':
      case 'hours':
      case 'h':
      case 'hr':
      case 'hrs':
        return 'hour';
      case 'week':
      case 'weeks':
        return 'week';
      case 'month':
      case 'months':
        return 'month';
      case 'quarter':
      case 'quarters':
        return 'quarter';
      case 'year':
      case 'years':
        return 'year';
      case 'day':
      case 'days':
      default:
        return 'day';
    }
  }

  dateAdd(date: string, count: string, unit: string): string {
    const { unit: cleanUnit, factor } = this.normalizeIntervalUnit(unit.replace(/^'|'$/g, ''));
    const numericCount = this.toNumericSafe(count, 1);
    const scaledCount = factor === 1 ? `(${numericCount})` : `(${numericCount}) * ${factor}`;
    const timestampExpr = this.castToTimestamp(date, 0);
    if (cleanUnit === 'quarter') {
      return `${timestampExpr} + (${scaledCount}) * INTERVAL '1 month'`;
    }
    return `${timestampExpr} + (${scaledCount}) * INTERVAL '1 ${cleanUnit}'`;
  }

  datestr(date: string): string {
    return `${this.castToTimestamp(date, 0)}::date::text`;
  }

  private buildMonthDiff(startDate: string, endDate: string): string {
    const startExpr = this.castToTimestamp(startDate, 0);
    const endExpr = this.castToTimestamp(endDate, 1);
    const startYear = `EXTRACT(YEAR FROM ${startExpr})`;
    const endYear = `EXTRACT(YEAR FROM ${endExpr})`;
    const startMonth = `EXTRACT(MONTH FROM ${startExpr})`;
    const endMonth = `EXTRACT(MONTH FROM ${endExpr})`;
    const startDay = `EXTRACT(DAY FROM ${startExpr})`;
    const endDay = `EXTRACT(DAY FROM ${endExpr})`;
    const startLastDay = `EXTRACT(DAY FROM (DATE_TRUNC('month', ${startExpr}) + INTERVAL '1 month - 1 day'))`;
    const endLastDay = `EXTRACT(DAY FROM (DATE_TRUNC('month', ${endExpr}) + INTERVAL '1 month - 1 day'))`;

    const baseMonths = `((${startYear} - ${endYear}) * 12 + (${startMonth} - ${endMonth}))`;
    const adjustDown = `(CASE WHEN ${baseMonths} > 0 AND ${startDay} < ${endDay} AND ${startDay} < ${startLastDay} THEN 1 ELSE 0 END)`;
    const adjustUp = `(CASE WHEN ${baseMonths} < 0 AND ${startDay} > ${endDay} AND ${endDay} < ${endLastDay} THEN 1 ELSE 0 END)`;

    return `(${baseMonths} - ${adjustDown} + ${adjustUp})`;
  }

  datetimeDiff(startDate: string, endDate: string, unit: string): string {
    const diffUnit = this.normalizeDiffUnit(unit.replace(/^'|'$/g, ''));
    const startExpr = this.castToTimestamp(startDate, 0);
    const endExpr = this.castToTimestamp(endDate, 1);
    const diffSeconds = `EXTRACT(EPOCH FROM ${startExpr} - ${endExpr})`;
    switch (diffUnit) {
      case 'millisecond':
        return `(${diffSeconds}) * 1000`;
      case 'second':
        return `(${diffSeconds})`;
      case 'minute':
        return `(${diffSeconds}) / 60`;
      case 'hour':
        return `(${diffSeconds}) / 3600`;
      case 'week':
        return `(${diffSeconds}) / (86400 * 7)`;
      case 'month':
        return this.buildMonthDiff(startDate, endDate);
      case 'quarter':
        return `${this.buildMonthDiff(startDate, endDate)} / 3.0`;
      case 'year': {
        const monthDiff = this.buildMonthDiff(startDate, endDate);
        return `CAST((${monthDiff}) / 12.0 AS INTEGER)`;
      }
      case 'day':
      default:
        return `(${diffSeconds}) / 86400`;
    }
  }

  datetimeFormat(date: string, format: string): string {
    return buildAirtableDatetimeFormatSql(this.castToTimestamp(date, 0), format);
  }

  datetimeParse(dateString: string, format?: string): string {
    const valueExpr = `(${dateString})`;
    const trustedDatetimeInput = this.hasTrustedDatetimeInput(0);

    if (format == null) {
      return trustedDatetimeInput ? valueExpr : this.guardDefaultDatetimeParse(valueExpr);
    }
    const trimmedFormat = format.trim();
    if (!trimmedFormat || trimmedFormat === 'undefined' || trimmedFormat.toLowerCase() === 'null') {
      return trustedDatetimeInput ? valueExpr : this.guardDefaultDatetimeParse(valueExpr);
    }
    if (trustedDatetimeInput) {
      return valueExpr;
    }
    const normalizedFormat = normalizeAirtableDatetimeFormatExpression(trimmedFormat);
    const toTimestampExpr = `TO_TIMESTAMP(${valueExpr}::text, ${normalizedFormat})`;
    const guardPattern = this.buildDatetimeParseGuardRegex(normalizedFormat);
    if (!guardPattern) {
      return toTimestampExpr;
    }
    const textExpr = `${valueExpr}::text`;
    const escapedPattern = guardPattern.replace(/'/g, "''");
    return `(CASE WHEN ${valueExpr} IS NULL THEN NULL WHEN ${textExpr} = '' THEN NULL WHEN ${textExpr} ~ '${escapedPattern}' THEN ${toTimestampExpr} ELSE NULL END)`;
  }

  day(date: string): string {
    return `EXTRACT(DAY FROM ${this.castToTimestamp(date, 0)})`;
  }

  private buildNowDiffByUnit(nowExpr: string, dateExpr: string, unit: string): string {
    const diffUnit = this.normalizeDiffUnit(unit.replace(/^'|'$/g, ''));
    const diffSeconds = `EXTRACT(EPOCH FROM ${nowExpr} - ${dateExpr})`;
    const diffMonths = `EXTRACT(MONTH FROM AGE(${nowExpr}, ${dateExpr})) + EXTRACT(YEAR FROM AGE(${nowExpr}, ${dateExpr})) * 12`;
    const diffYears = `EXTRACT(YEAR FROM AGE(${nowExpr}, ${dateExpr}))`;
    switch (diffUnit) {
      case 'millisecond':
        return `(${diffSeconds}) * 1000`;
      case 'second':
        return `(${diffSeconds})`;
      case 'minute':
        return `(${diffSeconds}) / 60`;
      case 'hour':
        return `(${diffSeconds}) / 3600`;
      case 'week':
        return `(${diffSeconds}) / (86400 * 7)`;
      case 'month':
        return diffMonths;
      case 'quarter':
        return `(${diffMonths}) / 3.0`;
      case 'year':
        return diffYears;
      case 'day':
      default:
        return `(${diffSeconds}) / 86400`;
    }
  }

  fromNow(date: string, unit = 'day'): string {
    // For generated columns, use the current timestamp at field creation time
    const dateExpr = this.castToTimestamp(date, 0);
    if (this.isGeneratedColumnContext) {
      const currentTimestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
      return this.buildNowDiffByUnit(`'${currentTimestamp}'::timestamp`, dateExpr, unit);
    }
    return this.buildNowDiffByUnit('NOW()', dateExpr, unit);
  }

  hour(date: string): string {
    return `EXTRACT(HOUR FROM ${this.castToTimestamp(date, 0)})`;
  }

  isAfter(date1: string, date2: string): string {
    return `${this.castToTimestamp(date1, 0)} > ${this.castToTimestamp(date2, 1)}`;
  }

  isBefore(date1: string, date2: string): string {
    return `${this.castToTimestamp(date1, 0)} < ${this.castToTimestamp(date2, 1)}`;
  }

  isSame(date1: string, date2: string, unit?: string): string {
    if (unit) {
      const trimmed = unit.trim();
      if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        const literal = trimmed.slice(1, -1);
        const normalized = this.normalizeTruncateUnit(literal);
        const safeUnit = normalized.replace(/'/g, "''");
        return `DATE_TRUNC('${safeUnit}', ${this.castToTimestamp(
          date1,
          0
        )}) = DATE_TRUNC('${safeUnit}', ${this.castToTimestamp(date2, 1)})`;
      }
      return `DATE_TRUNC(${unit}, ${this.castToTimestamp(date1, 0)}) = DATE_TRUNC(${unit}, ${this.castToTimestamp(date2, 1)})`;
    }
    return `${this.castToTimestamp(date1, 0)} = ${this.castToTimestamp(date2, 1)}`;
  }

  lastModifiedTime(): string {
    // This would typically reference a system column
    return '"__last_modified_time"';
  }

  minute(date: string): string {
    return `EXTRACT(MINUTE FROM ${this.castToTimestamp(date, 0)})`;
  }

  month(date: string): string {
    return `EXTRACT(MONTH FROM ${this.castToTimestamp(date, 0)})`;
  }

  second(date: string): string {
    return `EXTRACT(SECOND FROM ${this.castToTimestamp(date, 0)})`;
  }

  timestr(date: string): string {
    return `(${this.castToTimestamp(date, 0)})::time::text`;
  }

  toNow(date: string, unit = 'day'): string {
    return this.fromNow(date, unit);
  }

  weekNum(date: string): string {
    return `EXTRACT(WEEK FROM ${this.castToTimestamp(date, 0)})`;
  }

  weekday(date: string, _startDayOfWeek?: string): string {
    return `EXTRACT(DOW FROM ${this.castToTimestamp(date, 0)})`;
  }

  workday(startDate: string, days: string): string {
    if (!this.isDateLikeOperand(0)) {
      return 'NULL';
    }
    // Simplified implementation - doesn't account for weekends/holidays
    return `${this.castToTimestamp(startDate, 0)}::date + INTERVAL '1 day' * ${days}::integer`;
  }

  workdayDiff(startDate: string, endDate: string): string {
    if (!this.isDateLikeOperand(0) || !this.isDateLikeOperand(1)) {
      return 'NULL';
    }
    // Simplified implementation - doesn't account for weekends/holidays
    return `${this.castToTimestamp(endDate, 1)}::date - ${this.castToTimestamp(startDate, 0)}::date`;
  }

  year(date: string): string {
    return `EXTRACT(YEAR FROM ${this.castToTimestamp(date, 0)})`;
  }

  createdTime(): string {
    // This would typically reference a system column
    return '"__created_time"';
  }

  // Logical Functions
  if(condition: string, valueIfTrue: string, valueIfFalse: string): string {
    const booleanCondition = this.normalizeBooleanCondition(condition, 0);
    const trueIsBlank = this.isEmptyStringLiteral(valueIfTrue) || this.isNullLiteral(valueIfTrue);
    const falseIsBlank =
      this.isEmptyStringLiteral(valueIfFalse) || this.isNullLiteral(valueIfFalse);
    const resultIsDatetime = this.isDateLikeOperand(1) || this.isDateLikeOperand(2);
    if (resultIsDatetime) {
      const trueBranch = trueIsBlank ? 'NULL' : this.castToTimestamp(valueIfTrue, 1);
      const falseBranch = falseIsBlank ? 'NULL' : this.castToTimestamp(valueIfFalse, 2);
      return `CASE WHEN (${booleanCondition}) THEN ${trueBranch} ELSE ${falseBranch} END`;
    }
    const trueIsText = this.isTextLikeExpression(valueIfTrue, 1);
    const falseIsText = this.isTextLikeExpression(valueIfFalse, 2);
    const trueIsHardText = this.isHardTextExpression(valueIfTrue);
    const falseIsHardText = this.isHardTextExpression(valueIfFalse);
    const hasTextBranch = (trueIsText && !trueIsBlank) || (falseIsText && !falseIsBlank);
    const numericWithBlank =
      (trueIsBlank && !falseIsHardText && !falseIsText) ||
      (falseIsBlank && !trueIsHardText && !trueIsText);
    if (numericWithBlank) {
      const trueBranchNumeric = trueIsBlank ? 'NULL' : this.toNumericSafe(valueIfTrue, 1);
      const falseBranchNumeric = falseIsBlank ? 'NULL' : this.toNumericSafe(valueIfFalse, 2);
      return `CASE WHEN (${booleanCondition}) THEN ${trueBranchNumeric} ELSE ${falseBranchNumeric} END`;
    }
    const hasNumericBranch =
      this.isNumericLikeExpression(valueIfTrue, 1) || this.isNumericLikeExpression(valueIfFalse, 2);
    if (hasNumericBranch && !hasTextBranch) {
      const trueBranchNumeric = trueIsBlank ? 'NULL' : this.toNumericSafe(valueIfTrue, 1);
      const falseBranchNumeric = falseIsBlank ? 'NULL' : this.toNumericSafe(valueIfFalse, 2);
      return `CASE WHEN (${booleanCondition}) THEN ${trueBranchNumeric} ELSE ${falseBranchNumeric} END`;
    }
    const blankPresent = trueIsBlank || falseIsBlank;
    const hasTextAfterBlank = blankPresent ? false : hasTextBranch;
    const normalizeBlankAsNull = !hasTextAfterBlank && blankPresent;
    const trueBranch = hasTextAfterBlank
      ? this.coerceToTextComparable(valueIfTrue, 1)
      : trueIsBlank && normalizeBlankAsNull
        ? 'NULL'
        : valueIfTrue;
    const falseBranch = hasTextAfterBlank
      ? this.coerceToTextComparable(valueIfFalse, 2)
      : falseIsBlank && normalizeBlankAsNull
        ? 'NULL'
        : valueIfFalse;
    return `CASE WHEN (${booleanCondition}) THEN ${trueBranch} ELSE ${falseBranch} END`;
  }

  and(params: string[]): string {
    return `(${this.joinParams(params, ' AND ')})`;
  }

  or(params: string[]): string {
    return `(${this.joinParams(params, ' OR ')})`;
  }

  not(value: string): string {
    return `NOT (${value})`;
  }

  xor(params: string[]): string {
    // PostgreSQL doesn't have built-in XOR for multiple values
    // This is a simplified implementation for two values
    if (params.length === 2) {
      return `((${params[0]}) AND NOT (${params[1]})) OR (NOT (${params[0]}) AND (${params[1]}))`;
    }
    // For multiple values, we need a more complex implementation
    return `(${this.joinParams(
      params.map((p) => `CASE WHEN ${p} THEN 1 ELSE 0 END`),
      ' + '
    )}) % 2 = 1`;
  }

  blank(): string {
    return 'NULL';
  }

  error(_message: string): string {
    // ERROR function in PostgreSQL generated columns should return NULL
    // since we can't throw actual errors in generated columns
    return 'NULL';
  }

  isError(value: string): string {
    // PostgreSQL doesn't have a direct ISERROR function
    // This would need custom error handling logic
    return `CASE WHEN ${value} IS NULL THEN TRUE ELSE FALSE END`;
  }

  switch(
    expression: string,
    cases: Array<{ case: string; result: string }>,
    defaultResult?: string
  ): string {
    const hasTextResult =
      cases.some((c) => this.isTextLikeExpression(c.result)) ||
      (defaultResult ? this.isTextLikeExpression(defaultResult) : false);

    const normalizeResult = (value: string) =>
      hasTextResult ? this.coerceToTextComparable(value) : value;

    const normalizeCaseValue = (value: string) =>
      hasTextResult ? this.coerceToTextComparable(value) : value;

    const baseExpr = hasTextResult ? this.coerceToTextComparable(expression, 0) : expression;

    let caseStatement = `CASE ${baseExpr}`;

    for (const caseItem of cases) {
      caseStatement += ` WHEN ${normalizeCaseValue(caseItem.case)} THEN ${normalizeResult(
        caseItem.result
      )}`;
    }

    if (defaultResult) {
      caseStatement += ` ELSE ${normalizeResult(defaultResult)}`;
    }

    caseStatement += ' END';
    return caseStatement;
  }

  // Array Functions
  count(params: string[]): string {
    // Count non-null values
    return `(${params.map((p) => `CASE WHEN ${p} IS NOT NULL THEN 1 ELSE 0 END`).join(' + ')})`;
  }

  countA(params: string[]): string {
    // Count non-empty values (including zeros)
    const blankAwareChecks = params.map((p, index) => this.countANonNullExpression(p, index));
    return `(${blankAwareChecks.join(' + ')})`;
  }

  countAll(value: string): string {
    const paramInfo = this.getParamInfo(0);
    if (paramInfo.isJsonField || paramInfo.isMultiValueField) {
      const normalized = `COALESCE(NULLIF((${value})::jsonb, 'null'::jsonb), '[]'::jsonb)`;
      return `(CASE
        WHEN jsonb_typeof(${normalized}) = 'array' THEN jsonb_array_length(${normalized})
        ELSE 1
      END)`;
    }

    // For single values, return 1 if not null, 0 if null.
    return `CASE WHEN ${value} IS NULL THEN 0 ELSE 1 END`;
  }

  private normalizeJsonbArray(array: string): string {
    return `(CASE
      WHEN ${array} IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(to_jsonb(${array})) = 'array' THEN to_jsonb(${array})
      ELSE jsonb_build_array(to_jsonb(${array}))
    END)`;
  }

  private buildJsonArrayUnion(
    arrays: string[],
    opts?: { filterNulls?: boolean; withOrdinal?: boolean }
  ): string {
    const selects = arrays.map((array, index) => {
      const normalizedArray = this.normalizeJsonbArray(array);
      const whereClause = opts?.filterNulls
        ? " WHERE elem.value IS NOT NULL AND elem.value != 'null' AND elem.value != ''"
        : '';
      const ordinality = opts?.withOrdinal ? ', ord' : '';
      return `SELECT elem.value, ${index} AS arg_index${ordinality}
        FROM jsonb_array_elements_text(${normalizedArray}) WITH ORDINALITY AS elem(value, ord)${whereClause}`;
    });

    if (selects.length === 0) {
      return 'SELECT NULL::text AS value, 0 AS arg_index, 0 AS ord WHERE FALSE';
    }

    return selects.join(' UNION ALL ');
  }

  arrayJoin(array: string, separator?: string): string {
    const sep = separator || "', '";
    return `ARRAY_TO_STRING(${array}, ${sep})`;
  }

  arrayUnique(arrays: string[]): string {
    const unionQuery = this.buildJsonArrayUnion(arrays, { withOrdinal: true });
    return `ARRAY(
      SELECT DISTINCT ON (value) value
      FROM (${unionQuery}) AS combined(value, arg_index, ord)
      ORDER BY value, arg_index, ord
    )`;
  }

  arrayFlatten(arrays: string[]): string {
    const unionQuery = this.buildJsonArrayUnion(arrays, { withOrdinal: true });
    return `ARRAY(
      SELECT value
      FROM (${unionQuery}) AS combined(value, arg_index, ord)
      ORDER BY arg_index, ord
    )`;
  }

  arrayCompact(arrays: string[]): string {
    const unionQuery = this.buildJsonArrayUnion(arrays, { filterNulls: true, withOrdinal: true });
    return `ARRAY(
      SELECT value
      FROM (${unionQuery}) AS combined(value, arg_index, ord)
      ORDER BY arg_index, ord
    )`;
  }

  // System Functions
  recordId(): string {
    // Reference the primary key column
    return '"__id"';
  }

  autoNumber(): string {
    // Reference the auto-increment column
    return '"__auto_number"';
  }

  textAll(value: string): string {
    // Convert array to text representation
    return `ARRAY_TO_STRING(${value}, ', ')`;
  }

  // Override some base implementations for PostgreSQL-specific syntax
  castToNumber(value: string): string {
    return `${value}::numeric`;
  }

  castToString(value: string): string {
    return `${value}::text`;
  }

  castToBoolean(value: string): string {
    return `${value}::boolean`;
  }

  castToDate(value: string): string {
    return `${value}::timestamp`;
  }

  // Field Reference - PostgreSQL uses double quotes for identifiers
  fieldReference(_fieldId: string, columnName: string): string {
    // For regular field references, return the column reference
    // Note: Expansion is handled at the expression level, not at individual field reference level
    return `"${columnName}"`;
  }

  protected escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private guardDefaultDatetimeParse(valueExpr: string): string {
    const textExpr = `${valueExpr}::text`;
    const trimmedExpr = `NULLIF(BTRIM(${textExpr}), '')`;
    const sanitizedExpr = `CASE WHEN ${trimmedExpr} IS NULL THEN NULL WHEN LOWER(${trimmedExpr}) IN ('null', 'undefined') THEN NULL ELSE ${trimmedExpr} END`;
    const pattern = getDefaultDatetimeParsePattern();
    return `(CASE WHEN ${valueExpr} IS NULL THEN NULL WHEN ${sanitizedExpr} IS NULL THEN NULL WHEN ${sanitizedExpr} ~ '${pattern}' THEN ${valueExpr} ELSE NULL END)`;
  }

  private buildDatetimeParseGuardRegex(formatLiteral: string): string | null {
    if (!formatLiteral.startsWith("'") || !formatLiteral.endsWith("'")) {
      return null;
    }
    const literal = formatLiteral.slice(1, -1);
    const tokenPatterns: Array<[string, string]> = [
      ['HH24', '\\d{2}'],
      ['HH12', '\\d{2}'],
      ['HH', '\\d{2}'],
      ['AM', '[AaPp][Mm]'],
      ['MI', '\\d{2}'],
      ['SS', '\\d{2}'],
      ['MS', '\\d{1,3}'],
      ['YYYY', '\\d{4}'],
      ['YYY', '\\d{3}'],
      ['YY', '\\d{2}'],
      ['Y', '\\d'],
      ['MM', '\\d{2}'],
      ['DD', '\\d{2}'],
    ];
    const optionalTokens = new Set(['FM', 'TM', 'TH']);
    let pattern = '^';
    for (let i = 0; i < literal.length; ) {
      let matched = false;
      const remaining = literal.slice(i);
      const upperRemaining = remaining.toUpperCase();
      for (const [token, tokenPattern] of tokenPatterns) {
        if (upperRemaining.startsWith(token)) {
          pattern += tokenPattern;
          i += token.length;
          matched = true;
          break;
        }
      }
      if (matched) {
        continue;
      }
      const optionalToken = upperRemaining.slice(0, 2);
      if (optionalTokens.has(optionalToken)) {
        i += optionalToken.length;
        continue;
      }
      const currentChar = literal[i];
      if (/\s/.test(currentChar)) {
        pattern += '\\s';
      } else {
        pattern += currentChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      i += 1;
    }
    pattern += '$';
    return pattern;
  }
  private castToTimestamp(date: string, metadataIndex?: number): string {
    const isTimestampish = (expr: string): boolean => {
      const trimmed = this.stripOuterParentheses(expr);
      return (
        /::timestamp(tz)?\b/i.test(trimmed) ||
        /\bAT\s+TIME\s+ZONE\b/i.test(trimmed) ||
        /^NOW\(\)/i.test(trimmed) ||
        /^CURRENT_TIMESTAMP/i.test(trimmed)
      );
    };

    const paramInfo = metadataIndex != null ? this.getParamInfo(metadataIndex) : undefined;
    if (paramInfo?.hasMetadata && paramInfo.type === 'number') {
      return 'NULL::timestamp';
    }
    const looksDatetime =
      paramInfo?.hasMetadata &&
      (isDatetimeLikeParam(paramInfo) ||
        paramInfo.fieldDbType === DbFieldType.DateTime ||
        paramInfo.fieldCellValueType === 'datetime');

    if (!looksDatetime && !isTimestampish(date)) {
      return 'NULL::timestamp';
    }

    const valueExpr = `(${date})`;
    const trustedInput =
      (metadataIndex != null && this.hasTrustedDatetimeInput(metadataIndex)) ||
      this.getExpressionFieldType(date) === DbFieldType.DateTime;

    if (trustedInput) {
      return `${valueExpr}::timestamp`;
    }

    const guarded = this.guardDefaultDatetimeParse(valueExpr);
    return `${guarded}::timestamp`;
  }

  private hasTrustedDatetimeInput(index: number): boolean {
    const paramInfo = this.getParamInfo(index);
    if (!paramInfo.hasMetadata) {
      return false;
    }
    if (!isDatetimeLikeParam(paramInfo)) {
      return false;
    }
    if (paramInfo.isJsonField || paramInfo.isMultiValueField) {
      return false;
    }
    return true;
  }
}
