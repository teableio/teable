import { FormulaQueryAbstract } from '../formula-query.abstract';
import type { IFormulaConversionContext } from '../formula-query.interface';

/**
 * PostgreSQL-specific implementation of formula functions
 * Converts Teable formula functions to PostgreSQL SQL expressions
 */
export class FormulaQueryPostgres extends FormulaQueryAbstract {
  // Numeric Functions
  sum(params: string[]): string {
    return `SUM(${this.joinParams(params)})`;
  }

  average(params: string[]): string {
    return `AVG(${this.joinParams(params)})`;
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
    return `CONCAT(${this.joinParams(params)})`;
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

  dateAdd(date: string, count: string, unit: string): string {
    // Remove quotes from unit string literal for interval construction
    const cleanUnit = unit.replace(/^'|'$/g, '');
    return `${date}::timestamp + INTERVAL '${cleanUnit}' * ${count}::integer`;
  }

  datestr(date: string): string {
    return `${date}::date::text`;
  }

  datetimeDiff(startDate: string, endDate: string, unit: string): string {
    const cleanUnit = unit.replace(/^'|'$/g, '');
    switch (cleanUnit.toLowerCase()) {
      case 'day':
      case 'days':
        return `EXTRACT(DAY FROM ${endDate}::timestamp - ${startDate}::timestamp)`;
      case 'hour':
      case 'hours':
        return `EXTRACT(EPOCH FROM ${endDate}::timestamp - ${startDate}::timestamp) / 3600`;
      case 'minute':
      case 'minutes':
        return `EXTRACT(EPOCH FROM ${endDate}::timestamp - ${startDate}::timestamp) / 60`;
      case 'second':
      case 'seconds':
        return `EXTRACT(EPOCH FROM ${endDate}::timestamp - ${startDate}::timestamp)`;
      default:
        return `EXTRACT(DAY FROM ${endDate}::timestamp - ${startDate}::timestamp)`;
    }
  }

  datetimeFormat(date: string, format: string): string {
    return `TO_CHAR(${date}::timestamp, ${format})`;
  }

  datetimeParse(dateString: string, format: string): string {
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
      const cleanUnit = unit.replace(/^'|'$/g, '');
      switch (cleanUnit.toLowerCase()) {
        case 'day':
          return `DATE_TRUNC('day', ${date1}::timestamp) = DATE_TRUNC('day', ${date2}::timestamp)`;
        case 'month':
          return `DATE_TRUNC('month', ${date1}::timestamp) = DATE_TRUNC('month', ${date2}::timestamp)`;
        case 'year':
          return `DATE_TRUNC('year', ${date1}::timestamp) = DATE_TRUNC('year', ${date2}::timestamp)`;
        default:
          return `${date1}::timestamp = ${date2}::timestamp`;
      }
    }
    return `${date1}::timestamp = ${date2}::timestamp`;
  }

  lastModifiedTime(): string {
    // This would typically reference a system column
    return '__last_modified_time__';
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
    return '__created_time__';
  }

  // Logical Functions
  if(condition: string, valueIfTrue: string, valueIfFalse: string): string {
    return `CASE WHEN ${condition} THEN ${valueIfTrue} ELSE ${valueIfFalse} END`;
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
    return `(${params.map((p) => `CASE WHEN ${p} IS NOT NULL AND ${p} <> '' THEN 1 ELSE 0 END`).join(' + ')})`;
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
    // This would typically reference the primary key column
    return '__id__';
  }

  autoNumber(): string {
    // This would typically reference an auto-increment column
    return '__auto_number__';
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
  fieldReference(
    _fieldId: string,
    columnName: string,
    _context?: IFormulaConversionContext
  ): string {
    // For regular field references, return the column reference
    // Note: Expansion is handled at the expression level, not at individual field reference level
    return `"${columnName}"`;
  }

  protected escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }
}
