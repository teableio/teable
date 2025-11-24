/* eslint-disable sonarjs/cognitive-complexity */
import { DateFormattingPreset, DbFieldType, TimeFormatting } from '@teable/core';
import type { IDatetimeFormatting } from '@teable/core';
import type { ISelectFormulaConversionContext } from '../../../features/record/query-builder/sql-conversion.visitor';
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
    const trimmed = this.stripOuterParentheses(expr);
    // eslint-disable-next-line regexp/no-unused-capturing-group
    return /^[-+]?\d+(\.\d+)?$/.test(trimmed);
  }

  private toNumericSafe(expr: string, metadataIndex?: number): string {
    const paramInfo = this.getParamInfo(metadataIndex);
    if (isBooleanLikeParam(paramInfo)) {
      const boolScore = this.truthinessScore(expr, metadataIndex);
      return `(${boolScore})::double precision`;
    }
    if (isTrustedNumeric(paramInfo)) {
      return `(${expr})::double precision`;
    }

    return this.looseNumericCoercion(expr);
  }

  private looseNumericCoercion(expr: string): string {
    // Safely coerce any scalar to a floating-point number:
    // - Strip everything except digits, sign, decimal point
    // - Map empty string to NULL to avoid casting errors
    // Cast to DOUBLE PRECISION so pg driver returns JS numbers (not strings as with NUMERIC)
    if (this.isNumericLiteral(expr)) {
      return `(${expr})::double precision`;
    }
    const textExpr = `((${expr})::text)`;
    const sanitized = `REGEXP_REPLACE(${textExpr}, '[^0-9.+-]', '', 'g')`;
    return `NULLIF(${sanitized}, '')::double precision`;
  }

  private collapseNumeric(expr: string, metadataIndex?: number): string {
    const numericValue = this.toNumericSafe(expr, metadataIndex);
    return `COALESCE(${numericValue}, 0)`;
  }

  private isEmptyStringLiteral(value: string): boolean {
    return value.trim() === "''";
  }

  private isNullLiteral(value: string): boolean {
    return this.stripOuterParentheses(value).toUpperCase() === 'NULL';
  }

  private normalizeBlankComparable(value: string, metadataIndex?: number): string {
    const comparable = this.coerceToTextComparable(value, metadataIndex);
    return `COALESCE(NULLIF(${comparable}, ''), '')`;
  }

  private ensureTextCollation(expr: string): string {
    return `(${expr})::text`;
  }

  private isTextLikeExpression(value: string, metadataIndex?: number): boolean {
    const trimmed = this.stripOuterParentheses(value);
    if (/^'.*'$/.test(trimmed)) {
      return true;
    }

    const paramInfo = metadataIndex != null ? this.getParamInfo(metadataIndex) : undefined;
    if (paramInfo?.hasMetadata && isTextLikeParam(paramInfo)) {
      return true;
    }

    const columnMatch = trimmed.match(/^"([^"]+)"$/) ?? trimmed.match(/^"[^"]+"\."([^"]+)"$/);
    if (!columnMatch || columnMatch.length < 2) {
      return false;
    }

    const columnName = columnMatch[1];
    const table = this.context?.table;
    const field =
      table?.fieldList?.find((item) => item.dbFieldName === columnName) ??
      table?.fields?.ordered?.find((item) => item.dbFieldName === columnName);
    if (!field) {
      return false;
    }

    return field.dbFieldType === DbFieldType.Text;
  }

  private coerceArrayLikeToText(expr: string, metadataIndex?: number): string {
    const paramInfo = metadataIndex != null ? this.getParamInfo(metadataIndex) : undefined;
    const shouldFlatten = paramInfo?.isJsonField || paramInfo?.isMultiValueField;

    if (!shouldFlatten) {
      return this.ensureTextCollation(expr);
    }

    const textExpr = `((${expr})::text)`;
    const safeJsonExpr = `(CASE
      WHEN ${expr} IS NULL THEN NULL
      WHEN pg_typeof(${expr})::text IN ('json', 'jsonb') THEN (${expr})::jsonb
      ELSE NULL
    END)`;

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
    return `CASE jsonb_typeof(${jsonExpr})
          WHEN 'string' THEN (${jsonExpr}) #>> '{}'
          WHEN 'number' THEN (${jsonExpr}) #>> '{}'
          WHEN 'boolean' THEN (${jsonExpr}) #>> '{}'
          WHEN 'null' THEN NULL
          WHEN 'array' THEN COALESCE((
            SELECT STRING_AGG(elem.value, ', ' ORDER BY elem.ordinality)
            FROM jsonb_array_elements_text(${jsonExpr}) WITH ORDINALITY AS elem(value, ordinality)
          ), '')
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
    if (paramInfo?.hasMetadata) {
      if (isJsonLikeParam(paramInfo)) {
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
    const shouldNormalize =
      this.isEmptyStringLiteral(left) ||
      this.isEmptyStringLiteral(right) ||
      this.isNullLiteral(left) ||
      this.isNullLiteral(right);
    const leftIndex = metadataIndexes?.left;
    const rightIndex = metadataIndexes?.right;
    if (!shouldNormalize) {
      const leftIsText = this.isTextLikeExpression(left, leftIndex);
      const rightIsText = this.isTextLikeExpression(right, rightIndex);

      let normalizedLeft = left;
      let normalizedRight = right;

      if (leftIsText) {
        normalizedLeft = this.ensureTextCollation(left);
      }
      if (rightIsText) {
        normalizedRight = this.ensureTextCollation(right);
      }

      if (leftIsText && !rightIsText) {
        normalizedRight = this.coerceToTextComparable(right, rightIndex);
      } else if (!leftIsText && rightIsText) {
        normalizedLeft = this.coerceToTextComparable(left, leftIndex);
      }

      return `(${normalizedLeft} ${operator} ${normalizedRight})`;
    }

    const normalizedLeft = this.isEmptyStringLiteral(left)
      ? "''"
      : this.normalizeBlankComparable(left, leftIndex);
    const normalizedRight = this.isEmptyStringLiteral(right)
      ? "''"
      : this.normalizeBlankComparable(right, rightIndex);

    return `(${normalizedLeft} ${operator} ${normalizedRight})`;
  }

  private sanitizeTimestampInput(date: string): string {
    const trimmed = `NULLIF(BTRIM((${date})::text), '')`;
    return `CASE WHEN ${trimmed} IS NULL THEN NULL WHEN LOWER(${trimmed}) IN ('null', 'undefined') THEN NULL ELSE ${trimmed} END`;
  }

  private tzWrap(date: string): string {
    const tz = this.context?.timeZone as string | undefined;
    const sanitized = this.sanitizeTimestampInput(date);
    if (!tz) {
      // Default behavior: interpret as timestamp without timezone
      return `(${sanitized})::timestamp`;
    }
    // Sanitize single quotes to prevent SQL issues
    const safeTz = tz.replace(/'/g, "''");
    // Interpret input as timestamptz if it has offset and convert to target timezone
    // AT TIME ZONE returns timestamp without time zone in that zone
    return `(${sanitized})::timestamptz AT TIME ZONE '${safeTz}'`;
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

    const terms = params.map((param, index) => this.collapseNumeric(param, index));
    if (terms.length === 1) {
      return terms[0];
    }
    return `(${terms.join(' + ')})`;
  }

  average(params: string[]): string {
    if (params.length === 0) {
      return '0';
    }
    const numerator = this.sum(params);
    return `(${numerator}) / ${params.length}`;
  }

  max(params: string[]): string {
    return `GREATEST(${this.joinParams(params)})`;
  }

  min(params: string[]): string {
    return `LEAST(${this.joinParams(params)})`;
  }

  round(value: string, precision?: string): string {
    if (precision) {
      return `ROUND(${value}::numeric, ${precision}::integer)`;
    }
    return `ROUND(${value}::numeric)`;
  }

  roundUp(value: string, precision?: string): string {
    if (precision) {
      return `CEIL(${value}::numeric * POWER(10, ${precision}::integer)) / POWER(10, ${precision}::integer)`;
    }
    return `CEIL(${value}::numeric)`;
  }

  roundDown(value: string, precision?: string): string {
    if (precision) {
      return `FLOOR(${value}::numeric * POWER(10, ${precision}::integer)) / POWER(10, ${precision}::integer)`;
    }
    return `FLOOR(${value}::numeric)`;
  }

  ceiling(value: string): string {
    return `CEIL(${value}::numeric)`;
  }

  floor(value: string): string {
    return `FLOOR(${value}::numeric)`;
  }

  even(value: string): string {
    return `CASE WHEN ${value}::integer % 2 = 0 THEN ${value}::integer ELSE ${value}::integer + 1 END`;
  }

  odd(value: string): string {
    return `CASE WHEN ${value}::integer % 2 = 1 THEN ${value}::integer ELSE ${value}::integer + 1 END`;
  }

  int(value: string): string {
    return `FLOOR(${value}::numeric)`;
  }

  abs(value: string): string {
    return `ABS(${value}::numeric)`;
  }

  sqrt(value: string): string {
    return `SQRT(${value}::numeric)`;
  }

  power(base: string, exponent: string): string {
    return `POWER(${base}::numeric, ${exponent}::numeric)`;
  }

  exp(value: string): string {
    return `EXP(${value}::numeric)`;
  }

  log(value: string, base?: string): string {
    if (base) {
      return `LOG(${base}::numeric, ${value}::numeric)`;
    }
    return `LN(${value}::numeric)`;
  }

  mod(dividend: string, divisor: string): string {
    return `MOD(${dividend}::numeric, ${divisor}::numeric)`;
  }

  value(text: string): string {
    return this.toNumericSafe(text, 0);
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
    if (instanceNum) {
      // PostgreSQL doesn't have direct support for replacing specific instance
      // This is a simplified implementation
      return `REPLACE(${text}, ${oldText}, ${newText})`;
    }
    return `REPLACE(${text}, ${oldText}, ${newText})`;
  }

  lower(text: string): string {
    return `LOWER(${text})`;
  }

  upper(text: string): string {
    return `UPPER(${text})`;
  }

  rept(text: string, numTimes: string): string {
    return `REPEAT(${text}, ${numTimes}::integer)`;
  }

  trim(text: string): string {
    return `TRIM(${text})`;
  }

  len(text: string): string {
    return `LENGTH(${text})`;
  }

  t(value: string): string {
    return `CASE WHEN ${value} IS NULL THEN '' ELSE ${value}::text END`;
  }

  encodeUrlComponent(text: string): string {
    // PostgreSQL doesn't have built-in URL encoding, would need custom function
    return `encode(${text}::bytea, 'escape')`;
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
    const scaledCount = factor === 1 ? `(${count})` : `(${count}) * ${factor}`;
    if (cleanUnit === 'quarter') {
      return `${this.tzWrap(date)} + (${scaledCount}) * INTERVAL '1 month'`;
    }
    return `${this.tzWrap(date)} + (${scaledCount}) * INTERVAL '1 ${cleanUnit}'`;
  }

  datestr(date: string): string {
    return `(${this.tzWrap(date)})::date::text`;
  }

  private buildMonthDiff(startDate: string, endDate: string): string {
    const startExpr = this.tzWrap(startDate);
    const endExpr = this.tzWrap(endDate);
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
    const diffSeconds = `EXTRACT(EPOCH FROM (${this.tzWrap(startDate)} - ${this.tzWrap(endDate)}))`;
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
    return `TO_CHAR(${this.tzWrap(date)}, ${format})`;
  }

  datetimeParse(dateString: string, format?: string): string {
    const valueExpr = `(${dateString})`;
    const trustedDatetimeInput = this.hasTrustedDatetimeInput(0);

    if (format == null) {
      return trustedDatetimeInput ? valueExpr : this.guardDefaultDatetimeParse(valueExpr);
    }
    const normalized = format.trim();
    if (!normalized || normalized === 'undefined' || normalized.toLowerCase() === 'null') {
      return trustedDatetimeInput ? valueExpr : this.guardDefaultDatetimeParse(valueExpr);
    }
    if (trustedDatetimeInput) {
      return valueExpr;
    }
    const toTimestampExpr = `TO_TIMESTAMP(${valueExpr}::text, ${format})`;
    const guardPattern = this.buildDatetimeParseGuardRegex(normalized);
    if (!guardPattern) {
      return toTimestampExpr;
    }
    const textExpr = `${valueExpr}::text`;
    const escapedPattern = guardPattern.replace(/'/g, "''");
    return `(CASE WHEN ${valueExpr} IS NULL THEN NULL WHEN ${textExpr} = '' THEN NULL WHEN ${textExpr} ~ '${escapedPattern}' THEN ${toTimestampExpr} ELSE NULL END)`;
  }

  day(date: string): string {
    return `EXTRACT(DAY FROM ${this.tzWrap(date)})::int`;
  }

  fromNow(date: string): string {
    const tz = this.context?.timeZone?.replace(/'/g, "''");
    if (tz) {
      return `EXTRACT(EPOCH FROM ((NOW() AT TIME ZONE '${tz}') - ${this.tzWrap(date)}))`;
    }
    return `EXTRACT(EPOCH FROM (NOW() - ${date}::timestamp))`;
  }

  hour(date: string): string {
    return `EXTRACT(HOUR FROM ${this.tzWrap(date)})::int`;
  }

  isAfter(date1: string, date2: string): string {
    return `${this.tzWrap(date1)} > ${this.tzWrap(date2)}`;
  }

  isBefore(date1: string, date2: string): string {
    return `${this.tzWrap(date1)} < ${this.tzWrap(date2)}`;
  }

  isSame(date1: string, date2: string, unit?: string): string {
    if (unit) {
      const trimmed = unit.trim();
      if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        const literal = trimmed.slice(1, -1);
        const normalizedUnit = this.normalizeTruncateUnit(literal);
        const safeUnit = normalizedUnit.replace(/'/g, "''");
        return `DATE_TRUNC('${safeUnit}', ${this.tzWrap(date1)}) = DATE_TRUNC('${safeUnit}', ${this.tzWrap(date2)})`;
      }
      return `DATE_TRUNC(${unit}, ${this.tzWrap(date1)}) = DATE_TRUNC(${unit}, ${this.tzWrap(date2)})`;
    }
    return `${this.tzWrap(date1)} = ${this.tzWrap(date2)}`;
  }

  lastModifiedTime(): string {
    // This would typically reference a system column
    return this.qualifySystemColumn('__last_modified_time');
  }

  minute(date: string): string {
    return `EXTRACT(MINUTE FROM ${this.tzWrap(date)})::int`;
  }

  month(date: string): string {
    return `EXTRACT(MONTH FROM ${this.tzWrap(date)})::int`;
  }

  second(date: string): string {
    return `EXTRACT(SECOND FROM ${this.tzWrap(date)})::int`;
  }

  timestr(date: string): string {
    return `(${this.tzWrap(date)})::time::text`;
  }

  toNow(date: string): string {
    const tz = this.context?.timeZone?.replace(/'/g, "''");
    if (tz) {
      return `EXTRACT(EPOCH FROM (${this.tzWrap(date)} - (NOW() AT TIME ZONE '${tz}')))`;
    }
    return `EXTRACT(EPOCH FROM (${date}::timestamp - NOW()))`;
  }

  weekNum(date: string): string {
    return `EXTRACT(WEEK FROM ${this.tzWrap(date)})::int`;
  }

  weekday(date: string): string {
    return `EXTRACT(DOW FROM ${this.tzWrap(date)})::int`;
  }

  workday(startDate: string, days: string): string {
    // Simplified implementation in the target timezone
    return `(${this.tzWrap(startDate)})::date + INTERVAL '${days} days'`;
  }

  workdayDiff(startDate: string, endDate: string): string {
    // Simplified implementation
    return `${endDate}::date - ${startDate}::date`;
  }

  year(date: string): string {
    return `EXTRACT(YEAR FROM ${this.tzWrap(date)})::int`;
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
      return `CASE WHEN COALESCE(${wrapped}, FALSE) THEN 1 ELSE 0 END`;
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
    return `CASE WHEN (${truthinessScore}) = 1 THEN ${valueIfTrue} ELSE ${valueIfFalse} END`;
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
    let sql = `CASE ${expression}`;
    for (const caseItem of cases) {
      sql += ` WHEN ${caseItem.case} THEN ${caseItem.result}`;
    }
    if (defaultResult) {
      sql += ` ELSE ${defaultResult}`;
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
    return this.countANonNullExpression(value, 0);
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

  arrayUnique(array: string): string {
    const normalizedArray = this.normalizeJsonbArray(array);
    return `ARRAY(
      SELECT DISTINCT elem.value
      FROM jsonb_array_elements_text(${normalizedArray}) AS elem(value)
    )`;
  }

  arrayFlatten(array: string): string {
    const normalizedArray = this.normalizeJsonbArray(array);
    return `ARRAY(
      SELECT elem.value
      FROM jsonb_array_elements_text(${normalizedArray}) AS elem(value)
    )`;
  }

  arrayCompact(array: string): string {
    const normalizedArray = this.normalizeJsonbArray(array);
    return `ARRAY(
      SELECT elem.value
      FROM jsonb_array_elements_text(${normalizedArray}) AS elem(value)
      WHERE elem.value IS NOT NULL AND elem.value != 'null'
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
    const l = this.collapseNumeric(left, 0);
    const r = this.collapseNumeric(right, 1);
    return `((${l}) + (${r}))`;
  }

  subtract(left: string, right: string): string {
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
    return `(${left} > ${right})`;
  }

  lessThan(left: string, right: string): string {
    return `(${left} < ${right})`;
  }

  greaterThanOrEqual(left: string, right: string): string {
    return `(${left} >= ${right})`;
  }

  lessThanOrEqual(left: string, right: string): string {
    return `(${left} <= ${right})`;
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
    const numericValue = this.toNumericSafe(value);
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
