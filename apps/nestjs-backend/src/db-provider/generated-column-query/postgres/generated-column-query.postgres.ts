/* eslint-disable no-useless-escape */
import { DbFieldType } from '@teable/core';
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

  private normalizeBlankComparable(value: string): string {
    return `COALESCE(NULLIF((${value})::text, ''), '')`;
  }

  private buildBlankAwareComparison(operator: '=' | '<>', left: string, right: string): string {
    const shouldNormalize = this.isEmptyStringLiteral(left) || this.isEmptyStringLiteral(right);
    if (!shouldNormalize) {
      return `(${left} ${operator} ${right})`;
    }

    const normalizedLeft = this.isEmptyStringLiteral(left)
      ? "''"
      : this.normalizeBlankComparable(left);
    const normalizedRight = this.isEmptyStringLiteral(right)
      ? "''"
      : this.normalizeBlankComparable(right);

    return `(${normalizedLeft} ${operator} ${normalizedRight})`;
  }

  private isTextLikeExpression(value: string): boolean {
    const trimmed = value.trim();
    if (/^'.*'$/.test(trimmed)) {
      return true;
    }

    const columnMatch = trimmed.match(/^"([^"]+)"$/);
    if (!columnMatch) {
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

  private countANonNullExpression(value: string): string {
    if (this.isTextLikeExpression(value)) {
      const normalizedComparable = this.normalizeBlankComparable(value);
      return `CASE WHEN ${value} IS NULL OR ${normalizedComparable} = '' THEN 0 ELSE 1 END`;
    }

    return `CASE WHEN ${value} IS NULL THEN 0 ELSE 1 END`;
  }

  private normalizeBooleanCondition(condition: string): string {
    const wrapped = `(${condition})`;
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
    return `(${params.join(' + ')})`;
  }

  average(params: string[]): string {
    // Use addition and division instead of AVG() aggregation function for generated columns
    return `(${params.join(' + ')}) / ${params.length}`;
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
    return `${text}::numeric`;
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
    return this.buildBlankAwareComparison('=', left, right);
  }

  notEqual(left: string, right: string): string {
    return this.buildBlankAwareComparison('<>', left, right);
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
    if (startNum) {
      return `POSITION(${searchText} IN SUBSTRING(${withinText} FROM ${startNum}::integer)) + ${startNum}::integer - 1`;
    }
    return `POSITION(${searchText} IN ${withinText})`;
  }

  search(searchText: string, withinText: string, startNum?: string): string {
    // PostgreSQL doesn't have case-insensitive POSITION, so we use ILIKE with pattern matching
    if (startNum) {
      return `POSITION(UPPER(${searchText}) IN UPPER(SUBSTRING(${withinText} FROM ${startNum}::integer))) + ${startNum}::integer - 1`;
    }
    return `POSITION(UPPER(${searchText}) IN UPPER(${withinText}))`;
  }

  mid(text: string, startNum: string, numChars: string): string {
    return `SUBSTRING(${text} FROM ${startNum}::integer FOR ${numChars}::integer)`;
  }

  left(text: string, numChars: string): string {
    return `LEFT(${text}, ${numChars}::integer)`;
  }

  right(text: string, numChars: string): string {
    return `RIGHT(${text}, ${numChars}::integer)`;
  }

  replace(oldText: string, startNum: string, numChars: string, newText: string): string {
    return `OVERLAY(${oldText} PLACING ${newText} FROM ${startNum}::integer FOR ${numChars}::integer)`;
  }

  regexpReplace(text: string, pattern: string, replacement: string): string {
    return `REGEXP_REPLACE(${text}, ${pattern}, ${replacement}, 'g')`;
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
  ): 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' {
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

  dateAdd(date: string, count: string, unit: string): string {
    const { unit: cleanUnit, factor } = this.normalizeIntervalUnit(unit.replace(/^'|'$/g, ''));
    const scaledCount = factor === 1 ? `(${count})` : `(${count}) * ${factor}`;
    if (cleanUnit === 'quarter') {
      return `${date}::timestamp + (${scaledCount}) * INTERVAL '1 month'`;
    }
    return `${date}::timestamp + (${scaledCount}) * INTERVAL '1 ${cleanUnit}'`;
  }

  datestr(date: string): string {
    return `${date}::date::text`;
  }

  datetimeDiff(startDate: string, endDate: string, unit: string): string {
    const diffUnit = this.normalizeDiffUnit(unit.replace(/^'|'$/g, ''));
    const diffSeconds = `EXTRACT(EPOCH FROM ${endDate}::timestamp - ${startDate}::timestamp)`;
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
      case 'day':
      default:
        return `(${diffSeconds}) / 86400`;
    }
  }

  datetimeFormat(date: string, format: string): string {
    return `TO_CHAR(${date}::timestamp, ${format})`;
  }

  datetimeParse(dateString: string, format?: string): string {
    if (format == null) {
      return dateString;
    }
    const normalized = format.trim();
    if (!normalized || normalized === 'undefined' || normalized.toLowerCase() === 'null') {
      return dateString;
    }
    return `TO_TIMESTAMP(${dateString}, ${format})`;
  }

  day(date: string): string {
    return `EXTRACT(DAY FROM ${date}::timestamp)`;
  }

  fromNow(date: string): string {
    // For generated columns, use the current timestamp at field creation time
    if (this.isGeneratedColumnContext) {
      const currentTimestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
      return `EXTRACT(EPOCH FROM '${currentTimestamp}'::timestamp - ${date}::timestamp)`;
    }
    return `EXTRACT(EPOCH FROM NOW() - ${date}::timestamp)`;
  }

  hour(date: string): string {
    return `EXTRACT(HOUR FROM ${date}::timestamp)`;
  }

  isAfter(date1: string, date2: string): string {
    return `${date1}::timestamp > ${date2}::timestamp`;
  }

  isBefore(date1: string, date2: string): string {
    return `${date1}::timestamp < ${date2}::timestamp`;
  }

  isSame(date1: string, date2: string, unit?: string): string {
    if (unit) {
      const trimmed = unit.trim();
      if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        const literal = trimmed.slice(1, -1);
        const normalized = this.normalizeTruncateUnit(literal);
        const safeUnit = normalized.replace(/'/g, "''");
        return `DATE_TRUNC('${safeUnit}', ${date1}::timestamp) = DATE_TRUNC('${safeUnit}', ${date2}::timestamp)`;
      }
      return `DATE_TRUNC(${unit}, ${date1}::timestamp) = DATE_TRUNC(${unit}, ${date2}::timestamp)`;
    }
    return `${date1}::timestamp = ${date2}::timestamp`;
  }

  lastModifiedTime(): string {
    // This would typically reference a system column
    return '"__last_modified_time"';
  }

  minute(date: string): string {
    return `EXTRACT(MINUTE FROM ${date}::timestamp)`;
  }

  month(date: string): string {
    return `EXTRACT(MONTH FROM ${date}::timestamp)`;
  }

  second(date: string): string {
    return `EXTRACT(SECOND FROM ${date}::timestamp)`;
  }

  timestr(date: string): string {
    return `${date}::time::text`;
  }

  toNow(date: string): string {
    // For generated columns, use the current timestamp at field creation time
    if (this.isGeneratedColumnContext) {
      const currentTimestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
      return `EXTRACT(EPOCH FROM ${date}::timestamp - '${currentTimestamp}'::timestamp)`;
    }
    return `EXTRACT(EPOCH FROM ${date}::timestamp - NOW())`;
  }

  weekNum(date: string): string {
    return `EXTRACT(WEEK FROM ${date}::timestamp)`;
  }

  weekday(date: string): string {
    return `EXTRACT(DOW FROM ${date}::timestamp)`;
  }

  workday(startDate: string, days: string): string {
    // Simplified implementation - doesn't account for weekends/holidays
    return `${startDate}::date + INTERVAL '1 day' * ${days}::integer`;
  }

  workdayDiff(startDate: string, endDate: string): string {
    // Simplified implementation - doesn't account for weekends/holidays
    return `${endDate}::date - ${startDate}::date`;
  }

  year(date: string): string {
    return `EXTRACT(YEAR FROM ${date}::timestamp)`;
  }

  createdTime(): string {
    // This would typically reference a system column
    return '"__created_time"';
  }

  // Logical Functions
  if(condition: string, valueIfTrue: string, valueIfFalse: string): string {
    const booleanCondition = this.normalizeBooleanCondition(condition);
    return `CASE WHEN (${booleanCondition}) THEN ${valueIfTrue} ELSE ${valueIfFalse} END`;
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
    return `(${this.joinParams(params, ' + ')}) % 2 = 1`;
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
    let caseStatement = 'CASE';

    for (const caseItem of cases) {
      caseStatement += ` WHEN ${expression} = ${caseItem.case} THEN ${caseItem.result}`;
    }

    if (defaultResult) {
      caseStatement += ` ELSE ${defaultResult}`;
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
    const blankAwareChecks = params.map((p) => this.countANonNullExpression(p));
    return `(${blankAwareChecks.join(' + ')})`;
  }

  countAll(value: string): string {
    // For arrays, this would count array elements
    // For single values, return 1 if not null, 0 if null
    return `CASE WHEN ${value} IS NULL THEN 0 ELSE 1 END`;
  }

  arrayJoin(array: string, separator?: string): string {
    const sep = separator || "', '";
    return `ARRAY_TO_STRING(${array}, ${sep})`;
  }

  arrayUnique(array: string): string {
    // PostgreSQL has array_unique in some versions
    return `ARRAY(SELECT DISTINCT UNNEST(${array}))`;
  }

  arrayFlatten(array: string): string {
    // Flatten nested arrays
    return `ARRAY(SELECT UNNEST(${array}))`;
  }

  arrayCompact(array: string): string {
    // Remove null values from array
    return `ARRAY(SELECT x FROM UNNEST(${array}) AS x WHERE x IS NOT NULL)`;
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
}
