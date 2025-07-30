import { FormulaQueryAbstract } from '../formula-query.abstract';
import type { IFormulaConversionContext } from '../formula-query.interface';

/**
 * SQLite-specific implementation of formula functions
 * Converts Teable formula functions to SQLite SQL expressions
 */
export class FormulaQuerySqlite extends FormulaQueryAbstract {
  // Numeric Functions
  sum(params: string[]): string {
    return `SUM(${this.joinParams(params)})`;
  }

  average(params: string[]): string {
    return `AVG(${this.joinParams(params)})`;
  }

  max(params: string[]): string {
    return `MAX(${this.joinParams(params)})`;
  }

  min(params: string[]): string {
    return `MIN(${this.joinParams(params)})`;
  }

  round(value: string, precision?: string): string {
    if (precision) {
      return `ROUND(${value}, ${precision})`;
    }
    return `ROUND(${value})`;
  }

  roundUp(value: string, precision?: string): string {
    if (precision) {
      const factor = `POWER(10, ${precision})`;
      return `CAST(CEIL(${value} * ${factor}) / ${factor} AS REAL)`;
    }
    return `CAST(CEIL(${value}) AS INTEGER)`;
  }

  roundDown(value: string, precision?: string): string {
    if (precision) {
      const factor = `POWER(10, ${precision})`;
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
    return `SQRT(${value})`;
  }

  power(base: string, exponent: string): string {
    return `POWER(${base}, ${exponent})`;
  }

  exp(value: string): string {
    return `EXP(${value})`;
  }

  log(value: string, base?: string): string {
    if (base) {
      return `(LOG(${value}) / LOG(${base}))`;
    }
    return `LOG(${value})`;
  }

  mod(dividend: string, divisor: string): string {
    return `(${dividend} % ${divisor})`;
  }

  value(text: string): string {
    return `CAST(${text} AS REAL)`;
  }

  // Text Functions
  concatenate(params: string[]): string {
    return `(${this.joinParams(params, ' || ')})`;
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
    return `CASE WHEN ${value} IS NULL THEN '' ELSE CAST(${value} AS TEXT) END`;
  }

  encodeUrlComponent(text: string): string {
    // SQLite doesn't have built-in URL encoding
    return `${text}`;
  }

  // DateTime Functions
  now(): string {
    // For generated columns, use the current timestamp at field creation time
    if (this.isGeneratedColumnContext) {
      const currentTimestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
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

  dateAdd(date: string, count: string, unit: string): string {
    const cleanUnit = unit.replace(/^'|'$/g, '');
    switch (cleanUnit.toLowerCase()) {
      case 'day':
      case 'days':
        return `DATE(${date}, '+' || ${count} || ' days')`;
      case 'month':
      case 'months':
        return `DATE(${date}, '+' || ${count} || ' months')`;
      case 'year':
      case 'years':
        return `DATE(${date}, '+' || ${count} || ' years')`;
      case 'hour':
      case 'hours':
        return `DATETIME(${date}, '+' || ${count} || ' hours')`;
      case 'minute':
      case 'minutes':
        return `DATETIME(${date}, '+' || ${count} || ' minutes')`;
      case 'second':
      case 'seconds':
        return `DATETIME(${date}, '+' || ${count} || ' seconds')`;
      default:
        return `DATE(${date}, '+' || ${count} || ' days')`;
    }
  }

  datestr(date: string): string {
    return `DATE(${date})`;
  }

  datetimeDiff(startDate: string, endDate: string, unit: string): string {
    const cleanUnit = unit.replace(/^'|'$/g, '');
    switch (cleanUnit.toLowerCase()) {
      case 'day':
      case 'days':
        return `CAST(JULIANDAY(${endDate}) - JULIANDAY(${startDate}) AS INTEGER)`;
      case 'hour':
      case 'hours':
        return `CAST((JULIANDAY(${endDate}) - JULIANDAY(${startDate})) * 24 AS INTEGER)`;
      case 'minute':
      case 'minutes':
        return `CAST((JULIANDAY(${endDate}) - JULIANDAY(${startDate})) * 24 * 60 AS INTEGER)`;
      case 'second':
      case 'seconds':
        return `CAST((JULIANDAY(${endDate}) - JULIANDAY(${startDate})) * 24 * 60 * 60 AS INTEGER)`;
      default:
        return `CAST(JULIANDAY(${endDate}) - JULIANDAY(${startDate}) AS INTEGER)`;
    }
  }

  datetimeFormat(date: string, format: string): string {
    return `STRFTIME(${format}, ${date})`;
  }

  datetimeParse(dateString: string, format: string): string {
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
      const cleanUnit = unit.replace(/^'|'$/g, '');
      switch (cleanUnit.toLowerCase()) {
        case 'day':
          return `DATE(${date1}) = DATE(${date2})`;
        case 'month':
          return `STRFTIME('%Y-%m', ${date1}) = STRFTIME('%Y-%m', ${date2})`;
        case 'year':
          return `STRFTIME('%Y', ${date1}) = STRFTIME('%Y', ${date2})`;
        default:
          return `DATETIME(${date1}) = DATETIME(${date2})`;
      }
    }
    return `DATETIME(${date1}) = DATETIME(${date2})`;
  }

  lastModifiedTime(): string {
    return '__last_modified_time__';
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
    return `CAST(STRFTIME('%w', ${date}) AS INTEGER)`;
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
    // Count non-empty values (including zeros)
    return `(${params.map((p) => `CASE WHEN ${p} IS NOT NULL AND ${p} <> '' THEN 1 ELSE 0 END`).join(' + ')})`;
  }

  countAll(value: string): string {
    // For single values, return 1 if not null, 0 if null
    return `CASE WHEN ${value} IS NULL THEN 0 ELSE 1 END`;
  }

  arrayJoin(array: string, separator?: string): string {
    // SQLite doesn't have built-in array functions
    // This would need custom implementation or JSON functions
    const sep = separator || ', ';
    return `REPLACE(${array}, ',', ${this.stringLiteral(sep)})`;
  }

  arrayUnique(array: string): string {
    // SQLite doesn't have built-in array functions
    // This would need custom implementation
    return array;
  }

  arrayFlatten(array: string): string {
    // SQLite doesn't have built-in array functions
    return array;
  }

  arrayCompact(array: string): string {
    // SQLite doesn't have built-in array functions
    return array;
  }

  // System Functions
  recordId(): string {
    return '__id__';
  }

  autoNumber(): string {
    return '__auto_number__';
  }

  textAll(value: string): string {
    return `CAST(${value} AS TEXT)`;
  }

  // Field Reference - SQLite uses backticks for identifiers
  fieldReference(
    _fieldId: string,
    columnName: string,
    _context?: IFormulaConversionContext
  ): string {
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
