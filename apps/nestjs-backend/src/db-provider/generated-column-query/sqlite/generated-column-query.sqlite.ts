/* eslint-disable sonarjs/no-identical-functions */
import { GeneratedColumnQueryAbstract } from '../generated-column-query.abstract';

/**
 * SQLite-specific implementation of generated column query functions
 * Converts Teable formula functions to SQLite SQL expressions suitable
 * for use in generated columns. All generated SQL must be immutable.
 */
export class GeneratedColumnQuerySqlite extends GeneratedColumnQueryAbstract {
  private isEmptyStringLiteral(value: string): boolean {
    return value.trim() === "''";
  }

  private normalizeBlankComparable(value: string): string {
    return `COALESCE(NULLIF(CAST((${value}) AS TEXT), ''), '')`;
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

  // Numeric Functions
  sum(params: string[]): string {
    if (params.length === 0) {
      return 'NULL';
    }
    if (params.length === 1) {
      return `${params[0]}`;
    }
    // SQLite doesn't have SUM() for multiple values, use addition
    return `(${this.joinParams(params, ' + ')})`;
  }

  average(params: string[]): string {
    if (params.length === 0) {
      return 'NULL';
    }
    if (params.length === 1) {
      return `${params[0]}`;
    }
    // Calculate average as sum divided by count
    return `((${this.joinParams(params, ' + ')}) / ${params.length})`;
  }

  max(params: string[]): string {
    if (params.length === 0) {
      return 'NULL';
    }
    if (params.length === 1) {
      return `${params[0]}`;
    }
    // Use nested MAX functions for multiple values
    return params.reduce((acc, param) => `MAX(${acc}, ${param})`);
  }

  min(params: string[]): string {
    if (params.length === 0) {
      return 'NULL';
    }
    if (params.length === 1) {
      return `${params[0]}`;
    }
    // Use nested MIN functions for multiple values
    return params.reduce((acc, param) => `MIN(${acc}, ${param})`);
  }

  round(value: string, precision?: string): string {
    if (precision) {
      return `ROUND(${value}, ${precision})`;
    }
    return `ROUND(${value})`;
  }

  roundUp(value: string, precision?: string): string {
    if (precision) {
      // Use manual power calculation for 10^precision (common cases)
      const factor = `(
        CASE
          WHEN ${precision} = 0 THEN 1
          WHEN ${precision} = 1 THEN 10
          WHEN ${precision} = 2 THEN 100
          WHEN ${precision} = 3 THEN 1000
          WHEN ${precision} = 4 THEN 10000
          ELSE 1
        END
      )`;
      return `CAST(CEIL(${value} * ${factor}) / ${factor} AS REAL)`;
    }
    return `CAST(CEIL(${value}) AS INTEGER)`;
  }

  roundDown(value: string, precision?: string): string {
    if (precision) {
      // Use manual power calculation for 10^precision (common cases)
      const factor = `(
        CASE
          WHEN ${precision} = 0 THEN 1
          WHEN ${precision} = 1 THEN 10
          WHEN ${precision} = 2 THEN 100
          WHEN ${precision} = 3 THEN 1000
          WHEN ${precision} = 4 THEN 10000
          ELSE 1
        END
      )`;
      return `CAST(FLOOR(${value} * ${factor}) / ${factor} AS REAL)`;
    }
    return `CAST(FLOOR(${value}) AS INTEGER)`;
  }

  ceiling(value: string): string {
    return `CAST(CEIL(${value}) AS INTEGER)`;
  }

  floor(value: string): string {
    return `CAST(FLOOR(${value}) AS INTEGER)`;
  }

  even(value: string): string {
    return `CASE WHEN CAST(${value} AS INTEGER) % 2 = 0 THEN CAST(${value} AS INTEGER) ELSE CAST(${value} AS INTEGER) + 1 END`;
  }

  odd(value: string): string {
    return `CASE WHEN CAST(${value} AS INTEGER) % 2 = 1 THEN CAST(${value} AS INTEGER) ELSE CAST(${value} AS INTEGER) + 1 END`;
  }

  int(value: string): string {
    return `CAST(${value} AS INTEGER)`;
  }

  abs(value: string): string {
    return `ABS(${value})`;
  }

  sqrt(value: string): string {
    // SQLite doesn't have SQRT function, use Newton's method approximation
    // One iteration of Newton's method: (x/2 + x/(x/2)) / 2
    return `(
      CASE
        WHEN ${value} <= 0 THEN 0
        ELSE (${value} / 2.0 + ${value} / (${value} / 2.0)) / 2.0
      END
    )`;
  }

  power(base: string, exponent: string): string {
    // SQLite doesn't have POWER function, implement for common cases
    return `(
      CASE
        WHEN ${exponent} = 0 THEN 1
        WHEN ${exponent} = 1 THEN ${base}
        WHEN ${exponent} = 2 THEN ${base} * ${base}
        WHEN ${exponent} = 3 THEN ${base} * ${base} * ${base}
        WHEN ${exponent} = 4 THEN ${base} * ${base} * ${base} * ${base}
        WHEN ${exponent} = 0.5 THEN
          -- Square root case using Newton's method
          CASE
            WHEN ${base} <= 0 THEN 0
            ELSE (${base} / 2.0 + ${base} / (${base} / 2.0)) / 2.0
          END
        ELSE 1
      END
    )`;
  }

  exp(value: string): string {
    return `EXP(${value})`;
  }

  log(value: string, base?: string): string {
    if (base) {
      return `(LOG(${value}) / LOG(${base}))`;
    }
    // SQLite LOG is base 10, but formula LOG should be natural log (base e)
    return `LN(${value})`;
  }

  mod(dividend: string, divisor: string): string {
    return `(${dividend} % ${divisor})`;
  }

  value(text: string): string {
    return `CAST(${text} AS REAL)`;
  }

  // Text Functions
  concatenate(params: string[]): string {
    // Handle NULL values by converting them to empty strings for CONCATENATE function
    // This mirrors the behavior of the formula evaluation engine
    const nullSafeParams = params.map((param) => `COALESCE(${param}, '')`);
    return `(${this.joinParams(nullSafeParams, ' || ')})`;
  }

  // String concatenation for + operator (treats NULL as empty string)
  stringConcat(left: string, right: string): string {
    return `(COALESCE(${left}, '') || COALESCE(${right}, ''))`;
  }

  equal(left: string, right: string): string {
    return this.buildBlankAwareComparison('=', left, right);
  }

  notEqual(left: string, right: string): string {
    return this.buildBlankAwareComparison('<>', left, right);
  }

  find(searchText: string, withinText: string, startNum?: string): string {
    if (startNum) {
      return `CASE WHEN INSTR(SUBSTR(${withinText}, ${startNum}), ${searchText}) > 0 THEN INSTR(SUBSTR(${withinText}, ${startNum}), ${searchText}) + ${startNum} - 1 ELSE 0 END`;
    }
    return `INSTR(${withinText}, ${searchText})`;
  }

  search(searchText: string, withinText: string, startNum?: string): string {
    // SQLite INSTR is case-sensitive, so we use UPPER for case-insensitive search
    if (startNum) {
      return `CASE WHEN INSTR(UPPER(SUBSTR(${withinText}, ${startNum})), UPPER(${searchText})) > 0 THEN INSTR(UPPER(SUBSTR(${withinText}, ${startNum})), UPPER(${searchText})) + ${startNum} - 1 ELSE 0 END`;
    }
    return `INSTR(UPPER(${withinText}), UPPER(${searchText}))`;
  }

  mid(text: string, startNum: string, numChars: string): string {
    return `SUBSTR(${text}, ${startNum}, ${numChars})`;
  }

  left(text: string, numChars: string): string {
    return `SUBSTR(${text}, 1, ${numChars})`;
  }

  right(text: string, numChars: string): string {
    return `SUBSTR(${text}, -${numChars})`;
  }

  replace(oldText: string, startNum: string, numChars: string, newText: string): string {
    return `SUBSTR(${oldText}, 1, ${startNum} - 1) || ${newText} || SUBSTR(${oldText}, ${startNum} + ${numChars})`;
  }

  regexpReplace(text: string, pattern: string, replacement: string): string {
    // SQLite doesn't have built-in regex replace, would need extension
    return `REPLACE(${text}, ${pattern}, ${replacement})`;
  }

  substitute(text: string, oldText: string, newText: string, instanceNum?: string): string {
    // SQLite REPLACE replaces all instances, no direct support for specific instance
    return `REPLACE(${text}, ${oldText}, ${newText})`;
  }

  lower(text: string): string {
    return `LOWER(${text})`;
  }

  upper(text: string): string {
    return `UPPER(${text})`;
  }

  rept(text: string, numTimes: string): string {
    // SQLite doesn't have REPEAT function, need to use recursive CTE or custom function
    return `REPLACE(HEX(ZEROBLOB(${numTimes})), '00', ${text})`;
  }

  trim(text: string): string {
    return `TRIM(${text})`;
  }

  len(text: string): string {
    return `LENGTH(${text})`;
  }

  t(value: string): string {
    return `CASE
      WHEN ${value} IS NULL THEN ''
      WHEN ${value} = CAST(${value} AS INTEGER) THEN CAST(${value} AS INTEGER)
      ELSE CAST(${value} AS TEXT)
    END`;
  }

  encodeUrlComponent(text: string): string {
    // SQLite doesn't have built-in URL encoding
    return `${text}`;
  }

  // DateTime Functions
  now(): string {
    // For generated columns, use the current timestamp at field creation time
    if (this.isGeneratedColumnContext) {
      const currentTimestamp = new Date()
        .toISOString()
        .replace('T', ' ')
        .replace('Z', '')
        .replace(/\.\d{3}$/, '');
      return `'${currentTimestamp}'`;
    }
    return "DATETIME('now')";
  }

  today(): string {
    // For generated columns, use the current date at field creation time
    if (this.isGeneratedColumnContext) {
      const currentDate = new Date().toISOString().split('T')[0];
      return `'${currentDate}'`;
    }
    return "DATE('now')";
  }

  private normalizeDateModifier(unitLiteral: string): {
    unit: 'seconds' | 'minutes' | 'hours' | 'days' | 'months' | 'years';
    factor: number;
  } {
    const normalized = unitLiteral.replace(/^'|'$/g, '').trim().toLowerCase();
    switch (normalized) {
      case 'millisecond':
      case 'milliseconds':
      case 'ms':
        return { unit: 'seconds', factor: 0.001 };
      case 'second':
      case 'seconds':
      case 'sec':
      case 'secs':
        return { unit: 'seconds', factor: 1 };
      case 'minute':
      case 'minutes':
      case 'min':
      case 'mins':
        return { unit: 'minutes', factor: 1 };
      case 'hour':
      case 'hours':
      case 'hr':
      case 'hrs':
        return { unit: 'hours', factor: 1 };
      case 'week':
      case 'weeks':
        return { unit: 'days', factor: 7 };
      case 'month':
      case 'months':
        return { unit: 'months', factor: 1 };
      case 'quarter':
      case 'quarters':
        return { unit: 'months', factor: 3 };
      case 'year':
      case 'years':
        return { unit: 'years', factor: 1 };
      case 'day':
      case 'days':
      default:
        return { unit: 'days', factor: 1 };
    }
  }

  private normalizeDiffUnit(
    unitLiteral: string
  ): 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' {
    const normalized = unitLiteral.replace(/^'|'$/g, '').trim().toLowerCase();
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

  private normalizeTruncateFormat(unitLiteral: string): string {
    const normalized = unitLiteral.replace(/^'|'$/g, '').trim().toLowerCase();
    switch (normalized) {
      case 'millisecond':
      case 'milliseconds':
      case 'ms':
      case 'second':
      case 'seconds':
      case 'sec':
      case 'secs':
        return '%Y-%m-%d %H:%M:%S';
      case 'minute':
      case 'minutes':
      case 'min':
      case 'mins':
        return '%Y-%m-%d %H:%M';
      case 'hour':
      case 'hours':
      case 'hr':
      case 'hrs':
        return '%Y-%m-%d %H';
      case 'week':
      case 'weeks':
        return '%Y-%W';
      case 'month':
      case 'months':
        return '%Y-%m';
      case 'year':
      case 'years':
        return '%Y';
      case 'day':
      case 'days':
      default:
        return '%Y-%m-%d';
    }
  }

  dateAdd(date: string, count: string, unit: string): string {
    const { unit: cleanUnit, factor } = this.normalizeDateModifier(unit);
    const scaledCount = factor === 1 ? `(${count})` : `(${count}) * ${factor}`;
    return `DATETIME(${date}, (${scaledCount}) || ' ${cleanUnit}')`;
  }

  datestr(date: string): string {
    return `DATE(${date})`;
  }

  datetimeDiff(startDate: string, endDate: string, unit: string): string {
    const baseDiffDays = `(JULIANDAY(${endDate}) - JULIANDAY(${startDate}))`;
    switch (this.normalizeDiffUnit(unit)) {
      case 'millisecond':
        return `(${baseDiffDays}) * 24.0 * 60 * 60 * 1000`;
      case 'second':
        return `(${baseDiffDays}) * 24.0 * 60 * 60`;
      case 'minute':
        return `(${baseDiffDays}) * 24.0 * 60`;
      case 'hour':
        return `(${baseDiffDays}) * 24.0`;
      case 'week':
        return `(${baseDiffDays}) / 7.0`;
      case 'day':
      default:
        return `${baseDiffDays}`;
    }
  }

  datetimeFormat(date: string, format: string): string {
    // Convert common format patterns to SQLite STRFTIME format
    const cleanFormat = format.replace(/^'|'$/g, '');
    const sqliteFormat = cleanFormat
      .replace(/YYYY/g, '%Y')
      .replace(/MM/g, '%m')
      .replace(/DD/g, '%d')
      .replace(/HH/g, '%H')
      .replace(/mm/g, '%M')
      .replace(/ss/g, '%S');

    return `STRFTIME('${sqliteFormat}', ${date})`;
  }

  datetimeParse(dateString: string, _format?: string): string {
    // SQLite doesn't have direct parsing with custom format
    return `DATETIME(${dateString})`;
  }

  day(date: string): string {
    return `CAST(STRFTIME('%d', ${date}) AS INTEGER)`;
  }

  fromNow(date: string): string {
    // For generated columns, use the current timestamp at field creation time
    if (this.isGeneratedColumnContext) {
      const currentTimestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
      return `(JULIANDAY('${currentTimestamp}') - JULIANDAY(${date})) * 24 * 60 * 60`;
    }
    return `(JULIANDAY('now') - JULIANDAY(${date})) * 24 * 60 * 60`;
  }

  hour(date: string): string {
    return `CAST(STRFTIME('%H', ${date}) AS INTEGER)`;
  }

  isAfter(date1: string, date2: string): string {
    return `DATETIME(${date1}) > DATETIME(${date2})`;
  }

  isBefore(date1: string, date2: string): string {
    return `DATETIME(${date1}) < DATETIME(${date2})`;
  }

  isSame(date1: string, date2: string, unit?: string): string {
    if (unit) {
      const trimmed = unit.trim();
      if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        const format = this.normalizeTruncateFormat(trimmed.slice(1, -1));
        return `STRFTIME('${format}', ${date1}) = STRFTIME('${format}', ${date2})`;
      }
      const format = this.normalizeTruncateFormat(unit);
      return `STRFTIME('${format}', ${date1}) = STRFTIME('${format}', ${date2})`;
    }
    return `DATETIME(${date1}) = DATETIME(${date2})`;
  }

  lastModifiedTime(): string {
    return '__last_modified_time';
  }

  minute(date: string): string {
    return `CAST(STRFTIME('%M', ${date}) AS INTEGER)`;
  }

  month(date: string): string {
    return `CAST(STRFTIME('%m', ${date}) AS INTEGER)`;
  }

  second(date: string): string {
    return `CAST(STRFTIME('%S', ${date}) AS INTEGER)`;
  }

  timestr(date: string): string {
    return `TIME(${date})`;
  }

  toNow(date: string): string {
    // For generated columns, use the current timestamp at field creation time
    if (this.isGeneratedColumnContext) {
      const currentTimestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
      return `(JULIANDAY(${date}) - JULIANDAY('${currentTimestamp}')) * 24 * 60 * 60`;
    }
    return `(JULIANDAY(${date}) - JULIANDAY('now')) * 24 * 60 * 60`;
  }

  weekNum(date: string): string {
    return `CAST(STRFTIME('%W', ${date}) AS INTEGER)`;
  }

  weekday(date: string): string {
    // Convert SQLite's 0-based weekday (0=Sunday) to 1-based (1=Sunday)
    return `(CAST(STRFTIME('%w', ${date}) AS INTEGER) + 1)`;
  }

  workday(startDate: string, days: string): string {
    return `DATE(${startDate}, '+' || ${days} || ' days')`;
  }

  workdayDiff(startDate: string, endDate: string): string {
    return `CAST(JULIANDAY(${endDate}) - JULIANDAY(${startDate}) AS INTEGER)`;
  }

  year(date: string): string {
    return `CAST(STRFTIME('%Y', ${date}) AS INTEGER)`;
  }

  createdTime(): string {
    return '__created_time';
  }

  private normalizeBooleanCondition(condition: string): string {
    const wrapped = `(${condition})`;
    const valueType = `TYPEOF${wrapped}`;
    return `CASE
      WHEN ${wrapped} IS NULL THEN 0
      WHEN ${valueType} = 'integer' OR ${valueType} = 'real' THEN (${wrapped}) != 0
      WHEN ${valueType} = 'text' THEN (${wrapped} != '' AND LOWER(${wrapped}) != 'null')
      ELSE (${wrapped}) IS NOT NULL AND ${wrapped} != 'null'
    END`;
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
    // SQLite doesn't have built-in XOR for multiple values
    if (params.length === 2) {
      return `((${params[0]}) AND NOT (${params[1]})) OR (NOT (${params[0]}) AND (${params[1]}))`;
    }
    // For multiple values, count true values and check if odd
    return `(${this.joinParams(
      params.map((p) => `CASE WHEN ${p} THEN 1 ELSE 0 END`),
      ' + '
    )}) % 2 = 1`;
  }

  blank(): string {
    return 'NULL';
  }

  error(_message: string): string {
    // ERROR function in SQLite generated columns should return NULL
    // since we can't throw actual errors in generated columns
    return 'NULL';
  }

  isError(value: string): string {
    // SQLite doesn't have a direct ISERROR function
    return `CASE WHEN ${value} IS NULL THEN 1 ELSE 0 END`;
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
    // Count non-empty values (excluding empty strings)
    return `(${params.map((p) => `CASE WHEN ${p} IS NOT NULL AND ${p} <> '' THEN 1 ELSE 0 END`).join(' + ')})`;
  }

  countAll(value: string): string {
    // For single values, return 1 if not null, 0 if null
    return `CASE WHEN ${value} IS NULL THEN 0 ELSE 1 END`;
  }

  arrayJoin(array: string, separator?: string): string {
    // SQLite generated columns don't support subqueries, so we'll use simple string manipulation
    // This assumes arrays are stored as JSON strings like ["a","b","c"] or ["a", "b", "c"]
    const sep = separator ? this.stringLiteral(separator) : this.stringLiteral(', ');
    return `(
      CASE
        WHEN json_valid(${array}) AND json_type(${array}) = 'array' THEN
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${array}, '[', ''), ']', ''), '"', ''), ', ', ','), ',', ${sep})
        WHEN ${array} IS NOT NULL THEN CAST(${array} AS TEXT)
        ELSE NULL
      END
    )`;
  }

  arrayUnique(array: string): string {
    // SQLite generated columns don't support complex operations for uniqueness
    // For now, return the array as-is (this is a limitation)
    return `(
      CASE
        WHEN json_valid(${array}) AND json_type(${array}) = 'array' THEN ${array}
        ELSE ${array}
      END
    )`;
  }

  arrayFlatten(array: string): string {
    // For SQLite generated columns, flattening is complex without subqueries
    // Return the array as-is (this is a limitation)
    return `(
      CASE
        WHEN json_valid(${array}) AND json_type(${array}) = 'array' THEN ${array}
        ELSE ${array}
      END
    )`;
  }

  arrayCompact(array: string): string {
    // SQLite generated columns don't support complex filtering without subqueries
    // For now, return the array as-is (this is a limitation)
    return `(
      CASE
        WHEN json_valid(${array}) AND json_type(${array}) = 'array' THEN ${array}
        ELSE ${array}
      END
    )`;
  }

  // System Functions
  recordId(): string {
    return '__id';
  }

  autoNumber(): string {
    return '__auto_number';
  }

  textAll(value: string): string {
    // Use same logic as t() function to handle integer formatting
    return `CASE
      WHEN ${value} = CAST(${value} AS INTEGER) THEN CAST(${value} AS INTEGER)
      ELSE CAST(${value} AS TEXT)
    END`;
  }

  // Field Reference - SQLite uses backticks for identifiers
  fieldReference(_fieldId: string, columnName: string): string {
    // For regular field references, return the column reference
    // Note: Expansion is handled at the expression level, not at individual field reference level
    return `\`${columnName}\``;
  }

  // Override some base implementations for SQLite-specific syntax
  castToNumber(value: string): string {
    return `CAST(${value} AS REAL)`;
  }

  castToString(value: string): string {
    return `CAST(${value} AS TEXT)`;
  }

  castToBoolean(value: string): string {
    return `CAST(${value} AS INTEGER)`;
  }

  castToDate(value: string): string {
    return `DATETIME(${value})`;
  }

  // SQLite uses square brackets for identifiers with special characters
  protected escapeIdentifier(identifier: string): string {
    return `[${identifier.replace(/\]/g, ']]')}]`;
  }

  // Override binary operations to handle SQLite-specific behavior
  modulo(left: string, right: string): string {
    return `(${left} % ${right})`;
  }

  // SQLite uses different boolean literals
  booleanLiteral(value: boolean): string {
    return value ? '1' : '0';
  }
}
