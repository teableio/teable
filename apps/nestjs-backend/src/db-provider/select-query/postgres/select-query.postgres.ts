/* eslint-disable regexp/no-unused-capturing-group */
/* eslint-disable sonarjs/cognitive-complexity */
import { DateFormattingPreset, DbFieldType, TimeFormatting } from '@teable/core';
import type { IDatetimeFormatting } from '@teable/core';
import type { ISelectFormulaConversionContext } from '../../../features/record/query-builder/sql-conversion.visitor';
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
import { SelectQueryAbstract } from '../select-query.abstract';

/**
 * PostgreSQL-specific implementation of SELECT query functions
 * Converts Teable formula functions to PostgreSQL SQL expressions suitable
 * for use in SELECT statements. Unlike generated columns, these can use
 * mutable functions and have different optimization strategies.
 */
export class SelectQueryPostgres extends SelectQueryAbstract {
  private get tableAlias(): string | undefined {
    const ctx = this.context as ISelectFormulaConversionContext | undefined;
    return ctx?.tableAlias;
  }

  private qualifySystemColumn(column: string): string {
    const quoted = `"${column}"`;
    const alias = this.tableAlias;
    return alias ? `"${alias}".${quoted}` : quoted;
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

  private toNumericSafe(
    expr: string,
    metadataIndex?: number,
    opts?: { collate?: boolean; guardDateLike?: boolean }
  ): string {
    if (this.isNumericLiteral(expr)) {
      return `(${expr})::double precision`;
    }
    const paramInfo = this.getParamInfo(metadataIndex);
    const expressionFieldType = this.getExpressionFieldType(expr);
    const targetDbType = (this.context as ISelectFormulaConversionContext | undefined)
      ?.targetDbFieldType;

    if (isBooleanLikeParam(paramInfo)) {
      const boolScore = this.truthinessScore(expr, metadataIndex);
      return `(${boolScore})::double precision`;
    }
    if (
      paramInfo?.hasMetadata &&
      isTextLikeParam(paramInfo) &&
      !paramInfo.isJsonField &&
      !paramInfo.isMultiValueField
    ) {
      return this.looseNumericCoercion(expr, opts);
    }
    if (expressionFieldType === DbFieldType.Text) {
      return this.looseNumericCoercion(expr, opts);
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
    if (
      !paramInfo?.hasMetadata &&
      (targetDbType === DbFieldType.Real || targetDbType === DbFieldType.Integer)
    ) {
      return `(${expr})::double precision`;
    }

    return this.looseNumericCoercion(expr, opts);
  }

  private looseNumericCoercion(
    expr: string,
    opts?: { collate?: boolean; guardDateLike?: boolean }
  ): string {
    // Safely coerce any scalar to a floating-point number:
    // - Strip everything except digits, sign, decimal point
    // - Map empty string to NULL to avoid casting errors
    // Cast to DOUBLE PRECISION so pg driver returns JS numbers (not strings as with NUMERIC)
    if (this.isNumericLiteral(expr)) {
      return `(${expr})::double precision`;
    }
    const shouldCollate = opts?.collate !== false;
    const textExpr = shouldCollate ? `((${expr})::text) COLLATE "C"` : `((${expr})::text)`;
    // Avoid treating obvious date-like strings (e.g., 2024/12/03) as numbers
    const dateLikePattern = `'^[0-9]{1,4}[-/][0-9]{1,2}[-/][0-9]{1,4}( .*){0,1}$'`;
    const collatedDatePattern = `${dateLikePattern} COLLATE "C"`;
    const sanitized = `REGEXP_REPLACE(${textExpr}, '[^0-9.+-]', '', 'g')`;
    const cleaned = `NULLIF(${sanitized}, '')`;
    // Avoid "?" in the regex so knex.raw doesn't misinterpret it as a binding placeholder.
    const numericPattern = `'^[+-]{0,1}(\\d+(\\.\\d+){0,1}|\\.\\d+)$'`;
    const matchClause = shouldCollate
      ? `${cleaned} COLLATE "C" ~ ${numericPattern} COLLATE "C"`
      : `${cleaned} ~ ${numericPattern}`;
    const guards = [`WHEN ${cleaned} IS NULL THEN NULL`];
    if (opts?.guardDateLike) {
      const datePattern = shouldCollate ? collatedDatePattern : dateLikePattern;
      const dateGuardExpr = `${textExpr} ~ ${datePattern}`;
      guards.push(`WHEN ${dateGuardExpr} THEN NULL`);
    }
    guards.push(`WHEN ${matchClause} THEN ${cleaned}::double precision`);
    guards.push('ELSE NULL');
    return `(CASE ${guards.join(' ')} END)`;
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

  private buildNumericArrayAggregation(expr: string): { sum: string; count: string } {
    const arrayExpr = this.normalizeAnyToJsonArray(expr);
    const numericPattern = `'^[+-]{0,1}(\\d+(\\.\\d+){0,1}|\\.\\d+)$'`;
    const collatedPattern = `${numericPattern} COLLATE "C"`;
    const numericValue = `(CASE WHEN (elem.value COLLATE "C") ~ ${collatedPattern} THEN elem.value::double precision ELSE NULL END)`;
    const numericCount = `(CASE WHEN (elem.value COLLATE "C") ~ ${collatedPattern} THEN 1 ELSE 0 END)`;

    const sumExpr = `(SELECT SUM(${numericValue}) FROM jsonb_array_elements_text(${arrayExpr}) WITH ORDINALITY AS elem(value, ord))`;
    const countExpr = `(SELECT SUM(${numericCount}) FROM jsonb_array_elements_text(${arrayExpr}) WITH ORDINALITY AS elem(value, ord))`;
    return { sum: sumExpr, count: countExpr };
  }

  private buildNumericArrayExtremum(expr: string, op: 'max' | 'min'): string {
    const arrayExpr = this.normalizeAnyToJsonArray(expr);
    const numericPattern = `'^[+-]{0,1}(\\d+(\\.\\d+){0,1}|\\.\\d+)$'`;
    const collatedPattern = `${numericPattern} COLLATE "C"`;
    const numericValue = `(CASE WHEN (elem.value COLLATE "C") ~ ${collatedPattern} THEN elem.value::double precision ELSE NULL END)`;
    const agg = op === 'max' ? 'MAX' : 'MIN';
    return `(SELECT ${agg}(${numericValue}) FROM jsonb_array_elements_text(${arrayExpr}) WITH ORDINALITY AS elem(value, ord))`;
  }

  private collapseNumeric(expr: string, metadataIndex?: number): string {
    const numericValue = this.toNumericSafe(expr, metadataIndex);
    return `COALESCE(${numericValue}, 0)`;
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
    const numericValue = this.toNumericSafe(value, metadataIndex);
    return `COALESCE(${numericValue}, 0)`;
  }

  private normalizeBlankComparable(value: string, metadataIndex?: number): string {
    const comparable = this.coerceToTextComparable(value, metadataIndex);
    // Force text comparison so numeric fields compared against '' won't cast '' to double precision
    const textComparable = this.ensureTextCollation(comparable);
    return `COALESCE(NULLIF(${textComparable}, ''), '')`;
  }

  private ensureTextCollation(expr: string): string {
    return `(${expr})::text`;
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
    if (field) {
      return field.dbFieldType as DbFieldType | undefined;
    }

    // Handle CTE-projected lookup/rollup aliases like "lookup_<fieldId>" that aren't part of the
    // base table's dbFieldName list but still correspond to concrete field metadata.
    const lookupMatch = columnName.match(/^(lookup|rollup)_(fld[A-Za-z0-9]+)$/);
    if (lookupMatch && typeof table?.getField === 'function') {
      const byId = table.getField(lookupMatch[2]);
      return byId?.dbFieldType as DbFieldType | undefined;
    }

    return undefined;
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

  private coerceArrayLikeToText(expr: string, metadataIndex?: number): string {
    const paramInfo = metadataIndex != null ? this.getParamInfo(metadataIndex) : undefined;
    const shouldFlatten = paramInfo?.isJsonField || paramInfo?.isMultiValueField;

    if (!shouldFlatten) {
      return this.ensureTextCollation(expr);
    }

    const textExpr = `((${expr})::text)`;
    const safeJsonExpr = `(CASE WHEN ${expr} IS NULL THEN NULL ELSE to_jsonb(${expr}) END)`;

    const flattened = `(CASE
      WHEN ${expr} IS NULL THEN NULL
      WHEN ${safeJsonExpr} IS NULL THEN ${textExpr}
      WHEN jsonb_typeof(${safeJsonExpr}) = 'array' THEN (
        SELECT STRING_AGG(elem.value, ', ' ORDER BY elem.ordinality)
        FROM jsonb_array_elements_text(${safeJsonExpr}) WITH ORDINALITY AS elem(value, ordinality)
      )
      WHEN jsonb_typeof(${safeJsonExpr}) = 'object' THEN COALESCE(
        ${safeJsonExpr}->>'title',
        ${safeJsonExpr}->>'name',
        ${safeJsonExpr} #>> '{}'
      )
      ELSE ${safeJsonExpr} #>> '{}'
    END)`;

    return this.ensureTextCollation(flattened);
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

  private coerceJsonExpressionToText(wrapped: string, metadataIndex?: number): string {
    void metadataIndex;
    const jsonExpr = `to_jsonb${wrapped}`;
    return `(CASE
      WHEN ${wrapped} IS NULL THEN NULL
      ELSE ${this.buildJsonScalarCoercion(jsonExpr)}
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
    const isStringLiteral = /^'.*'$/.test(trimmed);
    if (isStringLiteral) {
      return trimmed;
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
      // Cast numeric operands to text so blank comparisons (e.g. field = '') don't try to
      // coerce '' into double precision and raise 22P02.
      return this.ensureTextCollation(wrapped);
    }
    if (paramInfo?.hasMetadata) {
      if (isJsonLikeParam(paramInfo)) {
        const coercedJson = this.coerceJsonExpressionToText(wrapped, metadataIndex);
        return this.ensureTextCollation(coercedJson);
      }

      if (isTextLikeParam(paramInfo)) {
        return this.isNumericLiteral(trimmed) ? this.ensureTextCollation(wrapped) : wrapped;
      }

      if (paramInfo.type && paramInfo.type !== 'unknown') {
        return this.ensureTextCollation(`${wrapped}::text`);
      }
    }

    // Heuristic: treat CASE/COALESCE/text-cast expressions as text without json wrapping to prevent
    // runaway query growth in nested IF chains.
    if (/^CASE\b/i.test(trimmed) || /::text\b/i.test(trimmed) || /\bCOALESCE\b/i.test(trimmed)) {
      return this.ensureTextCollation(wrapped);
    }

    const jsonbValue = `to_jsonb${wrapped}`;
    const flattenedArray = `(SELECT STRING_AGG(elem.value, ', ' ORDER BY elem.ordinality)
      FROM jsonb_array_elements_text(${jsonbValue}) WITH ORDINALITY AS elem(value, ordinality))`;
    const coerced = `(CASE
      WHEN ${wrapped} IS NULL THEN NULL
      ELSE
        CASE jsonb_typeof(${jsonbValue})
          WHEN 'string' THEN ${jsonbValue} #>> '{}'
          WHEN 'number' THEN ${jsonbValue} #>> '{}'
          WHEN 'boolean' THEN ${jsonbValue} #>> '{}'
          WHEN 'null' THEN NULL
          WHEN 'array' THEN COALESCE(${flattenedArray}, '')
          ELSE ${jsonbValue}::text
        END
    END)`;
    return this.ensureTextCollation(coerced);
  }

  private countANonNullExpression(value: string, metadataIndex?: number): string {
    if (this.isTextLikeExpression(value, metadataIndex)) {
      const normalizedComparable = this.normalizeBlankComparable(value, metadataIndex);
      return `CASE WHEN ${value} IS NULL OR ${normalizedComparable} = '' THEN 0 ELSE 1 END`;
    }

    return `CASE WHEN ${value} IS NULL THEN 0 ELSE 1 END`;
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
    const leftIsNullLiteral = this.isNullLiteral(left);
    const rightIsNullLiteral = this.isNullLiteral(right);
    const leftIsText = this.isTextLikeExpression(left, leftIndex);
    const rightIsText = this.isTextLikeExpression(right, rightIndex);
    const normalizeText =
      leftIsEmptyLiteral ||
      rightIsEmptyLiteral ||
      leftIsNullLiteral ||
      rightIsNullLiteral ||
      leftIsText ||
      rightIsText;

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

    const normalizeOperand = (
      value: string,
      isEmptyLiteral: boolean,
      isNullLiteral: boolean,
      metadataIndex?: number
    ) =>
      isEmptyLiteral || isNullLiteral ? "''" : this.normalizeBlankComparable(value, metadataIndex);

    const normalizedLeft = normalizeOperand(left, leftIsEmptyLiteral, leftIsNullLiteral, leftIndex);
    const normalizedRight = normalizeOperand(
      right,
      rightIsEmptyLiteral,
      rightIsNullLiteral,
      rightIndex
    );

    return `(${normalizedLeft} ${operator} ${normalizedRight})`;
  }

  private sanitizeTimestampInput(date: string): string {
    const trimmed = `NULLIF(BTRIM((${date})::text), '')`;
    const pattern = getDefaultDatetimeParsePattern().replace(/'/g, "''");
    return `CASE WHEN ${trimmed} IS NULL THEN NULL WHEN LOWER(${trimmed}) IN ('null', 'undefined') THEN NULL WHEN ${trimmed} ~ '${pattern}' THEN ${trimmed} ELSE NULL END`;
  }

  private isTrustedDatetime(expr: string, metadataIndex?: number): boolean {
    const paramInfo = metadataIndex != null ? this.getParamInfo(metadataIndex) : undefined;
    if (paramInfo?.hasMetadata) {
      const looksDatetime =
        isDatetimeLikeParam(paramInfo) ||
        paramInfo.fieldDbType === DbFieldType.DateTime ||
        paramInfo.fieldCellValueType === 'datetime';
      if (looksDatetime && !paramInfo.isJsonField && !paramInfo.isMultiValueField) {
        return true;
      }
      return false;
    }
    return false;
  }

  private isTimestampish(expr: string): boolean {
    const trimmed = this.stripOuterParentheses(expr);
    return (
      /::timestamp(tz)?\b/i.test(trimmed) ||
      /\bAT\s+TIME\s+ZONE\b/i.test(trimmed) ||
      /^NOW\(\)/i.test(trimmed) ||
      /^CURRENT_TIMESTAMP/i.test(trimmed)
    );
  }

  private shouldTreatAsDatetime(expr: string, metadataIndex?: number): boolean {
    const paramInfo = this.getParamInfo(metadataIndex);
    if (paramInfo?.hasMetadata) {
      // Explicit numeric/boolean metadata should not be coerced into datetime even if the expression
      // happens to contain timestamp-ish tokens (e.g. nested EXTRACT(... AT TIME ZONE ...)).
      if (paramInfo.type === 'number' || paramInfo.type === 'boolean') {
        return false;
      }
      const looksDatetime =
        isDatetimeLikeParam(paramInfo) ||
        paramInfo.fieldDbType === DbFieldType.DateTime ||
        paramInfo.fieldCellValueType === 'datetime';
      if (looksDatetime) {
        return true;
      }
    }
    return this.isTimestampish(expr);
  }

  private tzWrap(date: string, metadataIndex?: number): string {
    const tz = this.context?.timeZone as string | undefined;
    const shouldTreat = this.shouldTreatAsDatetime(date, metadataIndex);
    const trusted = shouldTreat && this.isTrustedDatetime(date, metadataIndex);
    const paramInfo = metadataIndex != null ? this.getParamInfo(metadataIndex) : undefined;
    const isTextLike = Boolean(paramInfo?.hasMetadata && isTextLikeParam(paramInfo));
    const alreadyTimestamp = !isTextLike && this.isTimestampish(date);
    const needsSanitize = !(trusted || alreadyTimestamp);
    const baseExpr = needsSanitize ? this.sanitizeTimestampInput(date) : `(${date})`;
    const wrappedBase = needsSanitize ? `(${baseExpr})` : baseExpr;

    if (!tz) {
      return `${wrappedBase}::timestamp`;
    }
    // Sanitize single quotes to prevent SQL issues
    const safeTz = tz.replace(/'/g, "''");
    return `${wrappedBase}::timestamptz AT TIME ZONE '${safeTz}'`;
  }

  private buildTimezoneOffsetSql(localTimestampSql: string): string {
    const tz = this.context?.timeZone as string | undefined;
    if (!tz) {
      return "'+00:00'";
    }

    const safeTz = tz.replace(/'/g, "''");
    const offsetMinutesSql = `ROUND(EXTRACT(EPOCH FROM (((${localTimestampSql}) AT TIME ZONE 'UTC') - ((${localTimestampSql}) AT TIME ZONE '${safeTz}'))) / 60)::int`;

    return `(CASE WHEN ${offsetMinutesSql} >= 0 THEN '+' ELSE '-' END || LPAD((ABS(${offsetMinutesSql}) / 60)::int::text, 2, '0') || ':' || LPAD((ABS(${offsetMinutesSql}) % 60)::int::text, 2, '0'))`;
  }

  private getDatePattern(date: DateFormattingPreset | string): string {
    const presetValues = Object.values(DateFormattingPreset) as string[];
    const normalizedPreset = presetValues.includes(date)
      ? (date as DateFormattingPreset)
      : DateFormattingPreset.ISO;

    switch (normalizedPreset) {
      case DateFormattingPreset.US:
        return 'FMMM/FMDD/YYYY';
      case DateFormattingPreset.European:
        return 'FMDD/FMMM/YYYY';
      case DateFormattingPreset.Asian:
        return 'YYYY/MM/DD';
      case DateFormattingPreset.YM:
        return 'YYYY-MM';
      case DateFormattingPreset.MD:
        return 'MM-DD';
      case DateFormattingPreset.Y:
        return 'YYYY';
      case DateFormattingPreset.M:
        return 'MM';
      case DateFormattingPreset.D:
        return 'DD';
      case DateFormattingPreset.ISO:
      default:
        return 'YYYY-MM-DD';
    }
  }

  private getTimePattern(time?: TimeFormatting): string | null {
    switch (time ?? TimeFormatting.None) {
      case TimeFormatting.Hour24:
        return 'HH24:MI';
      case TimeFormatting.Hour12:
        return 'HH12:MI AM';
      default:
        return null;
    }
  }

  private buildDatetimeFormatting(formatting?: Partial<IDatetimeFormatting>): {
    pattern: string;
    timeZone: string;
  } {
    const datePattern = this.getDatePattern(formatting?.date ?? DateFormattingPreset.ISO);
    const timePreset = formatting?.time as TimeFormatting | undefined;
    const timePattern = this.getTimePattern(timePreset);
    const pattern = (timePattern ? `${datePattern} ${timePattern}` : datePattern).replace(
      /'/g,
      "''"
    );
    const timeZone = (formatting?.timeZone ?? this.context?.timeZone ?? 'UTC').replace(/'/g, "''");
    return { pattern, timeZone };
  }

  private normalizeAnyToJsonArray(expr: string): string {
    const base = `(${expr})`;
    const jsonExpr = `to_jsonb${base}`;
    return `(CASE
      WHEN ${base} IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(${jsonExpr}) = 'array' THEN COALESCE(${jsonExpr}, '[]'::jsonb)
      ELSE jsonb_build_array(${jsonExpr})
    END)`;
  }

  private extractFirstScalarFromMultiValue(expr: string): string {
    const arrayExpr = this.normalizeAnyToJsonArray(expr);
    return `(SELECT elem #>> '{}'
      FROM jsonb_array_elements(${arrayExpr}) AS elem
      WHERE jsonb_typeof(elem) NOT IN ('array','object')
      LIMIT 1
    )`;
  }

  private formatDatetimeOperandForSlice(expr: string, metadataIndex: number): string | null {
    const paramInfo = this.getParamInfo(metadataIndex);
    const cellValueType = paramInfo.fieldCellValueType?.toLowerCase();
    let isDatetimeParam =
      isDatetimeLikeParam(paramInfo) ||
      cellValueType === 'datetime' ||
      paramInfo.fieldDbType === DbFieldType.DateTime;

    let formatting: IDatetimeFormatting | undefined;
    let timeZoneSource: string | undefined;

    if (paramInfo.hasMetadata) {
      const fieldId = this.currentCallMetadata?.[metadataIndex]?.field?.id;
      const field =
        fieldId && this.context?.table ? this.context.table.getField(fieldId) : undefined;
      formatting = (field as { options?: { formatting?: IDatetimeFormatting } } | undefined)
        ?.options?.formatting;
      timeZoneSource = formatting?.timeZone ?? this.context?.timeZone;
    } else if (this.context?.table) {
      const trimmed = this.stripOuterParentheses(expr);
      const columnMatch = trimmed.match(/^"[^"]+"\."([^"]+)"$/) ?? trimmed.match(/^"([^"]+)"$/);
      const dbName = columnMatch?.[1];
      if (dbName) {
        const field =
          this.context.table.fieldList?.find((item) => item.dbFieldName === dbName) ??
          this.context.table.fields?.ordered?.find((item) => item.dbFieldName === dbName);
        if (field?.dbFieldType === DbFieldType.DateTime) {
          isDatetimeParam = true;
          formatting = (field as { options?: { formatting?: IDatetimeFormatting } } | undefined)
            ?.options?.formatting;
          timeZoneSource = formatting?.timeZone ?? this.context?.timeZone;
        }
      }
    }

    if (!isDatetimeParam) {
      return null;
    }

    if (paramInfo.isMultiValueField) {
      const normalizedArray = this.normalizeAnyToJsonArray(expr);
      const { pattern, timeZone } = this.buildDatetimeFormatting({
        ...(formatting ?? {}),
        timeZone: timeZoneSource ?? this.context?.timeZone ?? 'UTC',
      });
      const scalar = `(CASE
        WHEN jsonb_typeof(elem) = 'object' THEN COALESCE(elem->>'title', elem->>'name', elem #>> '{}')
        ELSE elem #>> '{}'
      END)`;
      const sanitized = this.sanitizeTimestampInput(scalar);
      const formatted = `TO_CHAR(((${sanitized}))::timestamptz AT TIME ZONE '${timeZone}', '${pattern}')`;
      return `(SELECT string_agg(${formatted}, ', ' ORDER BY ord)
        FROM jsonb_array_elements(${normalizedArray}) WITH ORDINALITY AS t(elem, ord)
      )`;
    }

    let normalizedExpr = expr;
    if (paramInfo.isMultiValueField) {
      normalizedExpr = this.extractFirstScalarFromMultiValue(expr);
    }

    const { pattern, timeZone } = this.buildDatetimeFormatting({
      ...(formatting ?? {}),
      timeZone: timeZoneSource ?? this.context?.timeZone ?? 'UTC',
    });
    const sanitized = this.sanitizeTimestampInput(normalizedExpr);
    return `TO_CHAR((${sanitized})::timestamptz AT TIME ZONE '${timeZone}', '${pattern}')`;
  }

  private buildSliceOperand(expr: string, metadataIndex: number): string {
    const formattedDatetime = this.formatDatetimeOperandForSlice(expr, metadataIndex);
    if (formattedDatetime) {
      return `(${formattedDatetime})`;
    }
    return `(${expr})::text`;
  }
  // Numeric Functions
  sum(params: string[]): string {
    if (params.length === 0) {
      return '0';
    }

    const terms = params.map((param, index) => {
      const paramInfo = this.getParamInfo(index);
      if (paramInfo.isJsonField || paramInfo.isMultiValueField) {
        const { sum } = this.buildNumericArrayAggregation(param);
        return `COALESCE(${sum}, 0)`;
      }
      return this.collapseNumeric(param, index);
    });
    if (terms.length === 1) {
      return terms[0];
    }
    return `(${terms.join(' + ')})`;
  }

  average(params: string[]): string {
    if (params.length === 0) {
      return '0';
    }
    const sumTerms: string[] = [];
    const countTerms: string[] = [];

    params.forEach((param, index) => {
      const paramInfo = this.getParamInfo(index);
      if (paramInfo.isJsonField || paramInfo.isMultiValueField) {
        const { sum, count } = this.buildNumericArrayAggregation(param);
        sumTerms.push(`COALESCE(${sum}, 0)`);
        countTerms.push(`COALESCE(${count}, 0)`);
      } else {
        const numericValue = this.toNumericSafe(param, index);
        sumTerms.push(`COALESCE(${numericValue}, 0)`);
        countTerms.push('1');
      }
    });

    const numerator = sumTerms.length === 1 ? sumTerms[0] : `(${sumTerms.join(' + ')})`;
    const hasDynamicCount = countTerms.some((c) => c !== '1');
    if (!hasDynamicCount) {
      return `(${numerator}) / ${params.length}`;
    }
    const denominator = countTerms.length === 1 ? countTerms[0] : `(${countTerms.join(' + ')})`;
    return `(CASE WHEN ${denominator} = 0 THEN NULL ELSE (${numerator}) / ${denominator} END)`;
  }

  max(params: string[]): string {
    const mapped = params.map((param, index) => {
      const paramInfo = this.getParamInfo(index);
      if (paramInfo.isJsonField || paramInfo.isMultiValueField) {
        return this.buildNumericArrayExtremum(param, 'max');
      }
      return this.toNumericSafe(param, index);
    });
    return `GREATEST(${this.joinParams(mapped)})`;
  }

  min(params: string[]): string {
    const mapped = params.map((param, index) => {
      const paramInfo = this.getParamInfo(index);
      if (paramInfo.isJsonField || paramInfo.isMultiValueField) {
        return this.buildNumericArrayExtremum(param, 'min');
      }
      return this.toNumericSafe(param, index);
    });
    return `LEAST(${this.joinParams(mapped)})`;
  }

  round(value: string, precision?: string): string {
    if (precision) {
      return `ROUND(${value}::numeric, ${precision}::integer)`;
    }
    return `ROUND(${value}::numeric)`;
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
    return this.toNumericSafe(text, 0, { collate: true });
  }

  // Text Functions
  concatenate(params: string[]): string {
    return `CONCAT(${this.joinParams(params.map((p, idx) => this.coerceArrayLikeToText(p, idx)))})`;
  }

  stringConcat(left: string, right: string): string {
    return `CONCAT(${this.coerceArrayLikeToText(left, 0)}, ${this.coerceArrayLikeToText(
      right,
      1
    )})`;
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

    // Similar to find but case-insensitive
    if (startNum) {
      return `POSITION(UPPER(${normalizedSearch}) IN UPPER(SUBSTRING(${normalizedWithin} FROM ${startNum}::integer))) + ${startNum}::integer - 1`;
    }
    return `POSITION(UPPER(${normalizedSearch}) IN UPPER(${normalizedWithin}))`;
  }

  mid(text: string, startNum: string, numChars: string): string {
    const operand = this.buildSliceOperand(text, 0);
    return `SUBSTRING(${operand} FROM ${startNum}::integer FOR ${numChars}::integer)`;
  }

  left(text: string, numChars: string): string {
    const operand = this.buildSliceOperand(text, 0);
    return `LEFT(${operand}, ${numChars}::integer)`;
  }

  right(text: string, numChars: string): string {
    const operand = this.buildSliceOperand(text, 0);
    return `RIGHT(${operand}, ${numChars}::integer)`;
  }

  replace(oldText: string, startNum: string, numChars: string, newText: string): string {
    const source = this.buildSliceOperand(oldText, 0);
    const replacement = this.buildSliceOperand(newText, 3);
    return `OVERLAY(${source} PLACING ${replacement} FROM ${startNum}::integer FOR ${numChars}::integer)`;
  }

  regexpReplace(text: string, pattern: string, replacement: string): string {
    const source = this.ensureTextCollation(text);
    const regex = this.ensureTextCollation(pattern);
    const replacementText = this.ensureTextCollation(replacement);
    return `REGEXP_REPLACE(${source}, ${regex}, ${replacementText}, 'g')`;
  }

  substitute(text: string, oldText: string, newText: string, instanceNum?: string): string {
    const source = this.coerceArrayLikeToText(text, 0);
    const search = this.coerceArrayLikeToText(oldText, 1);
    const replacement = this.coerceArrayLikeToText(newText, 2);
    if (instanceNum) {
      // PostgreSQL doesn't have direct support for replacing specific instance
      // This is a simplified implementation
      return `REPLACE(${source}, ${search}, ${replacement})`;
    }
    return `REPLACE(${source}, ${search}, ${replacement})`;
  }

  lower(text: string): string {
    const operand = this.coerceArrayLikeToText(text, 0);
    return `LOWER(${operand})`;
  }

  upper(text: string): string {
    const operand = this.coerceArrayLikeToText(text, 0);
    return `UPPER(${operand})`;
  }

  rept(text: string, numTimes: string): string {
    const operand = this.coerceArrayLikeToText(text, 0);
    return `REPEAT(${operand}, ${numTimes}::integer)`;
  }

  trim(text: string): string {
    const operand = this.coerceArrayLikeToText(text, 0);
    return `TRIM(${operand})`;
  }

  len(text: string): string {
    // Cast to text to avoid calling LENGTH() on numeric types (e.g., auto-number)
    const operand = this.ensureTextCollation(this.coerceToTextComparable(text, 0));
    return `LENGTH(${operand})`;
  }

  t(value: string): string {
    return `CASE WHEN ${value} IS NULL THEN '' ELSE ${value}::text END`;
  }

  encodeUrlComponent(text: string): string {
    const textExpr = `(${text})::text`;
    const encodedSql = `(SELECT string_agg(
      CASE
        WHEN byte_val BETWEEN 48 AND 57
          OR byte_val BETWEEN 65 AND 90
          OR byte_val BETWEEN 97 AND 122
          OR byte_val IN (45, 95, 46, 33, 126, 42, 39, 40, 41)
        THEN chr(byte_val)
        ELSE '%' || UPPER(LPAD(to_hex(byte_val), 2, '0'))
      END,
      ''
      ORDER BY ord
    )
    FROM (
      SELECT ord, get_byte(src.bytes, ord) AS byte_val
      FROM (SELECT convert_to(${textExpr}, 'UTF8') AS bytes) AS src
      CROSS JOIN generate_series(0, octet_length(src.bytes) - 1) AS ord
    ) AS utf8_bytes)`;

    return `(CASE WHEN ${text} IS NULL THEN NULL ELSE COALESCE(${encodedSql}, '') END)`;
  }

  // DateTime Functions - These can use mutable functions in SELECT context
  now(): string {
    return `NOW()`;
  }

  today(): string {
    return `CURRENT_DATE`;
  }

  dateAdd(date: string, count: string, unit: string): string {
    const { unit: cleanUnit, factor } = this.normalizeIntervalUnit(unit.replace(/^'|'$/g, ''));
    const countExpr = `(${count})`;
    const scaledCount = factor === 1 ? `${countExpr}` : `${countExpr} * ${factor}`;
    const tsExpr = this.tzWrap(date, 0);
    if (cleanUnit === 'quarter') {
      return `${tsExpr} + (${scaledCount}) * INTERVAL '1 month'`;
    }
    return `${tsExpr} + (${scaledCount}) * INTERVAL '1 ${cleanUnit}'`;
  }

  datestr(date: string): string {
    return `(${this.tzWrap(date, 0)})::date::text`;
  }

  private buildMonthDiff(startDate: string, endDate: string): string {
    const startExpr = this.tzWrap(startDate, 0);
    const endExpr = this.tzWrap(endDate, 1);
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
    const diffSeconds = `EXTRACT(EPOCH FROM (${this.tzWrap(startDate, 0)} - ${this.tzWrap(
      endDate,
      1
    )}))`;
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
    const timestampExpr = this.tzWrap(date, 0);
    return buildAirtableDatetimeFormatSql(
      timestampExpr,
      format,
      this.buildTimezoneOffsetSql(timestampExpr)
    );
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
    return `EXTRACT(DAY FROM ${this.tzWrap(date, 0)})::int`;
  }

  private buildNowDiffByUnit(nowExpr: string, dateExpr: string, unit: string): string {
    const diffUnit = this.normalizeDiffUnit(unit.replace(/^'|'$/g, ''));
    const diffSeconds = `EXTRACT(EPOCH FROM (${nowExpr} - ${dateExpr}))`;
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
    const tz = this.context?.timeZone?.replace(/'/g, "''");
    if (tz) {
      return this.buildNowDiffByUnit(`(NOW() AT TIME ZONE '${tz}')`, this.tzWrap(date, 0), unit);
    }
    return this.buildNowDiffByUnit('NOW()', `${date}::timestamp`, unit);
  }

  hour(date: string): string {
    return `EXTRACT(HOUR FROM ${this.tzWrap(date, 0)})::int`;
  }

  isAfter(date1: string, date2: string): string {
    return `${this.tzWrap(date1, 0)} > ${this.tzWrap(date2, 1)}`;
  }

  isBefore(date1: string, date2: string): string {
    return `${this.tzWrap(date1, 0)} < ${this.tzWrap(date2, 1)}`;
  }

  isSame(date1: string, date2: string, unit?: string): string {
    if (unit) {
      const trimmed = unit.trim();
      if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        const literal = trimmed.slice(1, -1);
        const normalizedUnit = this.normalizeTruncateUnit(literal);
        const safeUnit = normalizedUnit.replace(/'/g, "''");
        return `DATE_TRUNC('${safeUnit}', ${this.tzWrap(date1, 0)}) = DATE_TRUNC('${safeUnit}', ${this.tzWrap(date2, 1)})`;
      }
      return `DATE_TRUNC(${unit}, ${this.tzWrap(date1, 0)}) = DATE_TRUNC(${unit}, ${this.tzWrap(
        date2,
        1
      )})`;
    }
    return `${this.tzWrap(date1, 0)} = ${this.tzWrap(date2, 1)}`;
  }

  lastModifiedTime(): string {
    // This would typically reference a system column
    return this.qualifySystemColumn('__last_modified_time');
  }

  minute(date: string): string {
    return `EXTRACT(MINUTE FROM ${this.tzWrap(date, 0)})::int`;
  }

  month(date: string): string {
    return `EXTRACT(MONTH FROM ${this.tzWrap(date, 0)})::int`;
  }

  second(date: string): string {
    return `EXTRACT(SECOND FROM ${this.tzWrap(date, 0)})::int`;
  }

  timestr(date: string): string {
    return `(${this.tzWrap(date, 0)})::time::text`;
  }

  toNow(date: string, unit = 'day'): string {
    return this.fromNow(date, unit);
  }

  weekNum(date: string): string {
    return `EXTRACT(WEEK FROM ${this.tzWrap(date, 0)})::int`;
  }

  weekday(date: string, startDayOfWeek?: string): string {
    const weekdaySql = `EXTRACT(DOW FROM ${this.tzWrap(date, 0)})::int`;
    if (!startDayOfWeek) {
      return weekdaySql;
    }

    const normalizedStartDay = `LOWER(BTRIM(COALESCE((${startDayOfWeek})::text, '')))`;
    return `CASE WHEN ${normalizedStartDay} = 'monday' THEN ((${weekdaySql} + 6) % 7) ELSE ${weekdaySql} END`;
  }

  workday(startDate: string, days: string): string {
    if (!this.isDateLikeOperand(0)) {
      return 'NULL';
    }
    // Simplified implementation in the target timezone; tzWrap sanitizes untrusted inputs
    // Use interval multiplication so dynamic expressions (e.g. field references) are valid SQL.
    return `(${this.tzWrap(startDate, 0)})::date + INTERVAL '1 day' * (${days})::double precision`;
  }

  workdayDiff(startDate: string, endDate: string): string {
    if (!this.isDateLikeOperand(0) || !this.isDateLikeOperand(1)) {
      return 'NULL';
    }
    // Simplified implementation with timezone-aware, sanitized inputs
    const start = `(${this.tzWrap(startDate, 0)})`;
    const end = `(${this.tzWrap(endDate, 1)})`;
    return `${end}::date - ${start}::date`;
  }

  year(date: string): string {
    return `EXTRACT(YEAR FROM ${this.tzWrap(date, 0)})::int`;
  }

  createdTime(): string {
    // This would typically reference a system column
    return this.qualifySystemColumn('__created_time');
  }

  // Logical Functions
  private truthinessScore(value: string, metadataIndex?: number): string {
    const normalizedValue = this.stripOuterParentheses(value);
    const wrapped = `(${normalizedValue})`;
    const paramInfo = this.getParamInfo(metadataIndex);

    if (isBooleanLikeParam(paramInfo)) {
      // Prefer the simplest form when the operand is a real boolean column to keep generated SQL
      // readable and stable for tests; otherwise cast to boolean to avoid COALESCE type errors
      // when the operand is boolean-ish text (e.g. 'true'/'false') in raw projection contexts.
      const boolExpr =
        paramInfo.isFieldReference && paramInfo.fieldDbType === DbFieldType.Boolean
          ? wrapped
          : `${wrapped}::boolean`;
      return `CASE WHEN COALESCE(${boolExpr}, FALSE) THEN 1 ELSE 0 END`;
    }

    if (
      paramInfo?.isJsonField ||
      paramInfo?.isMultiValueField ||
      paramInfo?.fieldDbType === DbFieldType.Json
    ) {
      return `CASE
        WHEN ${wrapped} IS NULL THEN 0
        WHEN (${wrapped})::text IN ('null', '[]', '{}', '') THEN 0
        ELSE 1
      END`;
    }

    if (isTrustedNumeric(paramInfo)) {
      const numericExpr = this.toNumericSafe(normalizedValue, metadataIndex);
      return `CASE WHEN COALESCE(${numericExpr}, 0) <> 0 THEN 1 ELSE 0 END`;
    }

    const conditionType = `pg_typeof${wrapped}::text`;
    const numericTypes = "('smallint','integer','bigint','numeric','double precision','real')";
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
      ELSE ${fallbackTruthyScore}
    END`;
  }

  if(condition: string, valueIfTrue: string, valueIfFalse: string): string {
    const truthinessScore = this.truthinessScore(condition, 0);
    const trueIsBlank = this.isEmptyStringLiteral(valueIfTrue) || this.isNullLiteral(valueIfTrue);
    const falseIsBlank =
      this.isEmptyStringLiteral(valueIfFalse) || this.isNullLiteral(valueIfFalse);
    const targetType = (this.context as ISelectFormulaConversionContext | undefined)
      ?.targetDbFieldType;
    const resultIsDatetime =
      targetType === DbFieldType.DateTime || this.isDateLikeOperand(1) || this.isDateLikeOperand(2);
    if (resultIsDatetime) {
      const trueBranch = trueIsBlank ? 'NULL' : this.tzWrap(valueIfTrue, 1);
      const falseBranch = falseIsBlank ? 'NULL' : this.tzWrap(valueIfFalse, 2);
      return `CASE WHEN (${truthinessScore}) = 1 THEN ${trueBranch} ELSE ${falseBranch} END`;
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
      return `CASE WHEN (${truthinessScore}) = 1 THEN ${trueBranchNumeric} ELSE ${falseBranchNumeric} END`;
    }
    const targetIsNumeric = targetType === DbFieldType.Real || targetType === DbFieldType.Integer;
    const hasNumericBranch =
      this.isNumericLikeExpression(valueIfTrue, 1) || this.isNumericLikeExpression(valueIfFalse, 2);
    if (targetIsNumeric || (hasNumericBranch && !hasTextBranch)) {
      const trueBranchNumeric = trueIsBlank ? 'NULL' : this.toNumericSafe(valueIfTrue, 1);
      const falseBranchNumeric = falseIsBlank ? 'NULL' : this.toNumericSafe(valueIfFalse, 2);
      return `CASE WHEN (${truthinessScore}) = 1 THEN ${trueBranchNumeric} ELSE ${falseBranchNumeric} END`;
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
    return `CASE WHEN (${truthinessScore}) = 1 THEN ${trueBranch} ELSE ${falseBranch} END`;
  }

  and(params: string[]): string {
    return `(${params.map((p) => `(${p})`).join(' AND ')})`;
  }

  or(params: string[]): string {
    return `(${params.map((p) => `(${p})`).join(' OR ')})`;
  }

  not(value: string): string {
    return `NOT (${value})`;
  }

  xor(params: string[]): string {
    // PostgreSQL doesn't have XOR, implement using AND/OR logic
    if (params.length === 2) {
      return `((${params[0]}) AND NOT (${params[1]})) OR (NOT (${params[0]}) AND (${params[1]}))`;
    }
    // For multiple params, use modulo approach
    return `(${params.map((p) => `CASE WHEN ${p} THEN 1 ELSE 0 END`).join(' + ')}) % 2 = 1`;
  }

  blank(): string {
    return 'NULL';
  }

  error(_message: string): string {
    // In SELECT context, we can use functions that raise errors
    return `(SELECT pg_catalog.pg_advisory_unlock_all() WHERE FALSE)`;
  }

  isError(_value: string): string {
    // Check if value would cause an error - simplified implementation
    return `FALSE`;
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
    let sql = `CASE ${baseExpr}`;
    for (const caseItem of cases) {
      sql += ` WHEN ${normalizeCaseValue(caseItem.case)} THEN ${normalizeResult(caseItem.result)}`;
    }
    if (defaultResult) {
      sql += ` ELSE ${normalizeResult(defaultResult)}`;
    }
    sql += ` END`;
    return sql;
  }

  // Array Functions - More flexible in SELECT context
  count(params: string[]): string {
    const countChecks = params.map((p) => `CASE WHEN ${p} IS NOT NULL THEN 1 ELSE 0 END`);
    return `(${countChecks.join(' + ')})`;
  }

  countA(params: string[]): string {
    const blankAwareChecks = params.map((p, index) => this.countANonNullExpression(p, index));
    return `(${blankAwareChecks.join(' + ')})`;
  }

  countAll(value: string): string {
    const paramInfo = this.getParamInfo(0);
    if (paramInfo.isJsonField || paramInfo.isMultiValueField) {
      const baseExpr =
        paramInfo.isFieldReference && paramInfo.fieldDbName
          ? this.tableAlias
            ? `"${this.tableAlias}"."${paramInfo.fieldDbName}"`
            : `"${paramInfo.fieldDbName}"`
          : value;
      const normalized = `COALESCE(NULLIF((${baseExpr})::jsonb, 'null'::jsonb), '[]'::jsonb)`;
      return `(CASE
        WHEN jsonb_typeof(${normalized}) = 'array' THEN jsonb_array_length(${normalized})
        ELSE 1
      END)`;
    }

    return `CASE WHEN ${value} IS NULL THEN 0 ELSE 1 END`;
  }

  private normalizeJsonbArray(array: string): string {
    return `(
      CASE
        WHEN ${array} IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(to_jsonb(${array})) = 'array' THEN to_jsonb(${array})
        ELSE jsonb_build_array(to_jsonb(${array}))
      END
    )`;
  }

  private buildJsonbArrayUnion(
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
    const sep = separator || `','`;
    const normalizedArray = this.normalizeJsonbArray(array);
    return `(
      SELECT string_agg(
        elem.value,
        ${sep}
      )
      FROM jsonb_array_elements_text(${normalizedArray}) AS elem(value)
    )`;
  }

  arrayUnique(arrays: string[]): string {
    const unionQuery = this.buildJsonbArrayUnion(arrays, { withOrdinal: true });
    return `ARRAY(
      SELECT DISTINCT ON (value) value
      FROM (${unionQuery}) AS combined(value, arg_index, ord)
      ORDER BY value, arg_index, ord
    )`;
  }

  arrayFlatten(arrays: string[]): string {
    const unionQuery = this.buildJsonbArrayUnion(arrays, { withOrdinal: true });
    return `ARRAY(
      SELECT value
      FROM (${unionQuery}) AS combined(value, arg_index, ord)
      ORDER BY arg_index, ord
    )`;
  }

  arrayCompact(arrays: string[]): string {
    const unionQuery = this.buildJsonbArrayUnion(arrays, { filterNulls: true, withOrdinal: true });
    return `ARRAY(
      SELECT value
      FROM (${unionQuery}) AS combined(value, arg_index, ord)
      ORDER BY arg_index, ord
    )`;
  }

  // System Functions
  recordId(): string {
    // This would typically reference the primary key
    return this.qualifySystemColumn('__id');
  }

  autoNumber(): string {
    // This would typically reference an auto-increment column
    return this.qualifySystemColumn('__auto_number');
  }

  textAll(value: string): string {
    return `${value}::text`;
  }

  // Binary Operations
  add(left: string, right: string): string {
    const leftIsDate = this.isDateLikeOperand(0);
    const rightIsDate = this.isDateLikeOperand(1);

    if (leftIsDate && !rightIsDate) {
      return `(${this.tzWrap(left, 0)} + ${this.buildDayInterval(right, 1)})`;
    }

    if (!leftIsDate && rightIsDate) {
      return `(${this.tzWrap(right, 1)} + ${this.buildDayInterval(left, 0)})`;
    }

    const l = this.collapseNumeric(left, 0);
    const r = this.collapseNumeric(right, 1);
    return `((${l}) + (${r}))`;
  }

  subtract(left: string, right: string): string {
    const leftIsDate = this.isDateLikeOperand(0);
    const rightIsDate = this.isDateLikeOperand(1);

    if (leftIsDate && !rightIsDate) {
      return `(${this.tzWrap(left, 0)} - ${this.buildDayInterval(right, 1)})`;
    }

    if (leftIsDate && rightIsDate) {
      return `(EXTRACT(EPOCH FROM (${this.tzWrap(left, 0)} - ${this.tzWrap(right, 1)})) / 86400)`;
    }

    const l = this.collapseNumeric(left, 0);
    const r = this.collapseNumeric(right, 1);
    return `((${l}) - (${r}))`;
  }

  multiply(left: string, right: string): string {
    const l = this.collapseNumeric(left, 0);
    const r = this.collapseNumeric(right, 1);
    return `((${l}) * (${r}))`;
  }

  divide(left: string, right: string): string {
    const numerator = this.collapseNumeric(left, 0);
    const denominator = this.toNumericSafe(right, 1);
    return `(CASE WHEN (${denominator}) IS NULL OR (${denominator}) = 0 THEN NULL ELSE (${numerator} / ${denominator}) END)`;
  }

  modulo(left: string, right: string): string {
    const dividend = this.collapseNumeric(left, 0);
    const divisor = this.toNumericSafe(right, 1);
    return `(CASE WHEN (${divisor}) IS NULL OR (${divisor}) = 0 THEN NULL ELSE MOD((${dividend})::numeric, (${divisor})::numeric)::double precision END)`;
  }

  // Comparison Operations
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

  // Logical Operations
  logicalAnd(left: string, right: string): string {
    return `(${left} AND ${right})`;
  }

  logicalOr(left: string, right: string): string {
    return `(${left} OR ${right})`;
  }

  bitwiseAnd(left: string, right: string): string {
    // Handle cases where operands might not be valid integers
    // Use COALESCE and NULLIF to safely convert to integer, defaulting to 0 for invalid values
    return `(
      COALESCE(
        CASE
          WHEN ${left}::text ~ '^-?[0-9]+$' THEN
            NULLIF(${left}::text, '')::integer
          ELSE NULL
        END,
        0
      ) &
      COALESCE(
        CASE
          WHEN ${right}::text ~ '^-?[0-9]+$' THEN
            NULLIF(${right}::text, '')::integer
          ELSE NULL
        END,
        0
      )
    )`;
  }

  // Unary Operations
  unaryMinus(value: string): string {
    const numericValue = this.toNumericSafe(value, 0);
    return `(-(${numericValue}))`;
  }

  // Field Reference
  fieldReference(_fieldId: string, columnName: string): string {
    return `"${columnName}"`;
  }

  // Literals
  stringLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  numberLiteral(value: number): string {
    return value.toString();
  }

  booleanLiteral(value: boolean): string {
    return value ? 'TRUE' : 'FALSE';
  }

  nullLiteral(): string {
    return 'NULL';
  }

  // Utility methods for type conversion and validation
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

  // Handle null values and type checking
  isNull(value: string): string {
    return `${value} IS NULL`;
  }

  coalesce(params: string[]): string {
    return `COALESCE(${this.joinParams(params)})`;
  }

  // Parentheses for grouping
  parentheses(expression: string): string {
    return `(${expression})`;
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
