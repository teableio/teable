import type { IFormulaConversionContext } from '@teable/core';
import { SelectQueryAbstract } from '../select-query.abstract';

/**
 * SQLite-specific implementation of SELECT query functions
 * Converts Teable formula functions to SQLite SQL expressions suitable
 * for use in SELECT statements. Unlike generated columns, these can use
 * more functions and have different optimization strategies.
 */
export class SelectQuerySqlite extends SelectQueryAbstract {
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
    // SQLite doesn't have CEIL with precision, implement manually
    if (precision) {
      return `CAST(CEIL(${value} * POWER(10, ${precision})) / POWER(10, ${precision}) AS REAL)`;
    }
    return `CAST(CEIL(${value}) AS INTEGER)`;
  }

  roundDown(value: string, precision?: string): string {
    // SQLite doesn't have FLOOR with precision, implement manually
    if (precision) {
      return `CAST(FLOOR(${value} * POWER(10, ${precision})) / POWER(10, ${precision}) AS REAL)`;
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
      // SQLite LOG is base-10, convert to natural log: ln(value) / ln(base)
      return `(LOG(${value}) * 2.302585092994046 / (LOG(${base}) * 2.302585092994046))`;
    }
    // SQLite LOG is base-10, convert to natural log: LOG(value) * ln(10)
    return `(LOG(${value}) * 2.302585092994046)`;
  }

  mod(dividend: string, divisor: string): string {
    return `(${dividend} % ${divisor})`;
  }

  value(text: string): string {
    return `CAST(${text} AS REAL)`;
  }

  // Text Functions
  concatenate(params: string[]): string {
    return `(${params.map((p) => `COALESCE(${p}, '')`).join(' || ')})`;
  }

  stringConcat(left: string, right: string): string {
    return `(COALESCE(${left}, '') || COALESCE(${right}, ''))`;
  }

  find(searchText: string, withinText: string, startNum?: string): string {
    if (startNum) {
      return `CASE WHEN INSTR(SUBSTR(${withinText}, ${startNum}), ${searchText}) > 0 THEN INSTR(SUBSTR(${withinText}, ${startNum}), ${searchText}) + ${startNum} - 1 ELSE 0 END`;
    }
    return `INSTR(${withinText}, ${searchText})`;
  }

  search(searchText: string, withinText: string, startNum?: string): string {
    // Case-insensitive search
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
    return `(SUBSTR(${oldText}, 1, ${startNum} - 1) || ${newText} || SUBSTR(${oldText}, ${startNum} + ${numChars}))`;
  }

  regexpReplace(text: string, pattern: string, replacement: string): string {
    // SQLite has limited regex support, use REPLACE for simple cases
    return `REPLACE(${text}, ${pattern}, ${replacement})`;
  }

  substitute(text: string, oldText: string, newText: string, instanceNum?: string): string {
    // SQLite doesn't support replacing specific instances easily
    return `REPLACE(${text}, ${oldText}, ${newText})`;
  }

  lower(text: string): string {
    return `LOWER(${text})`;
  }

  upper(text: string): string {
    return `UPPER(${text})`;
  }

  rept(text: string, numTimes: string): string {
    // SQLite doesn't have REPEAT, implement with recursive CTE or simple approach
    return `REPLACE(HEX(ZEROBLOB(${numTimes})), '00', ${text})`;
  }

  trim(text: string): string {
    return `TRIM(${text})`;
  }

  len(text: string): string {
    return `LENGTH(${text})`;
  }

  t(value: string): string {
    // SQLite T function should return numbers as numbers, not strings
    return `CASE WHEN ${value} IS NULL THEN '' WHEN typeof(${value}) = 'text' THEN ${value} ELSE ${value} END`;
  }

  encodeUrlComponent(text: string): string {
    // SQLite doesn't have built-in URL encoding
    return `${text}`;
  }

  // DateTime Functions - More flexible in SELECT context
  now(): string {
    return `DATETIME('now')`;
  }

  today(): string {
    return `DATE('now')`;
  }

  dateAdd(date: string, count: string, unit: string): string {
    return `DATETIME(${date}, '+' || ${count} || ' ${unit}')`;
  }

  datestr(date: string): string {
    return `DATE(${date})`;
  }

  datetimeDiff(startDate: string, endDate: string, unit: string): string {
    // SQLite has limited date arithmetic
    return `CAST((JULIANDAY(${endDate}) - JULIANDAY(${startDate})) AS INTEGER)`;
  }

  datetimeFormat(date: string, format: string): string {
    return `STRFTIME(${format}, ${date})`;
  }

  datetimeParse(dateString: string, format: string): string {
    // SQLite doesn't have direct parsing with custom formats
    return `DATETIME(${dateString})`;
  }

  day(date: string): string {
    return `CAST(STRFTIME('%d', ${date}) AS INTEGER)`;
  }

  fromNow(date: string): string {
    return `CAST((JULIANDAY('now') - JULIANDAY(${date})) * 86400 AS INTEGER)`;
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
      const formatMap: { [key: string]: string } = {
        year: '%Y',
        month: '%Y-%m',
        day: '%Y-%m-%d',
        hour: '%Y-%m-%d %H',
        minute: '%Y-%m-%d %H:%M',
        second: '%Y-%m-%d %H:%M:%S',
      };
      const format = formatMap[unit] || '%Y-%m-%d';
      return `STRFTIME('${format}', ${date1}) = STRFTIME('${format}', ${date2})`;
    }
    return `DATETIME(${date1}) = DATETIME(${date2})`;
  }

  lastModifiedTime(): string {
    return `"__last_modified_time"`;
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
    return `CAST((JULIANDAY(${date}) - JULIANDAY('now')) * 86400 AS INTEGER)`;
  }

  weekNum(date: string): string {
    return `CAST(STRFTIME('%W', ${date}) AS INTEGER)`;
  }

  weekday(date: string): string {
    // SQLite STRFTIME('%w') returns 0-6 (Sunday=0), but we need 1-7 (Sunday=1)
    return `CAST(STRFTIME('%w', ${date}) AS INTEGER) + 1`;
  }

  workday(startDate: string, days: string): string {
    // Simplified implementation
    return `DATE(${startDate}, '+' || ${days} || ' days')`;
  }

  workdayDiff(startDate: string, endDate: string): string {
    return `CAST((JULIANDAY(${endDate}) - JULIANDAY(${startDate})) AS INTEGER)`;
  }

  year(date: string): string {
    return `CAST(STRFTIME('%Y', ${date}) AS INTEGER)`;
  }

  createdTime(): string {
    return `"__created_time"`;
  }

  // Logical Functions
  if(condition: string, valueIfTrue: string, valueIfFalse: string): string {
    // Handle JSON values in conditions by checking if they are not null and not 'null'
    // This is needed for link fields that return JSON objects
    const booleanCondition = `(${condition} IS NOT NULL AND ${condition} != 'null')`;
    return `CASE WHEN ${booleanCondition} THEN ${valueIfTrue} ELSE ${valueIfFalse} END`;
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
    if (params.length === 2) {
      return `((${params[0]}) AND NOT (${params[1]})) OR (NOT (${params[0]}) AND (${params[1]}))`;
    }
    return `(${params.map((p) => `CASE WHEN ${p} THEN 1 ELSE 0 END`).join(' + ')}) % 2 = 1`;
  }

  blank(): string {
    // SQLite BLANK function should return null instead of empty string
    return `NULL`;
  }

  error(_message: string): string {
    // SQLite doesn't have a direct error function, use a failing expression
    return `(1/0)`;
  }

  isError(_value: string): string {
    return `0`;
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

  // Array Functions - Limited in SQLite
  count(params: string[]): string {
    return `COUNT(${this.joinParams(params)})`;
  }

  countA(params: string[]): string {
    return `COUNT(${this.joinParams(params.map((p) => `CASE WHEN ${p} IS NOT NULL THEN 1 END`))})`;
  }

  countAll(_value: string): string {
    return `COUNT(*)`;
  }

  arrayJoin(array: string, separator?: string): string {
    const sep = separator || ',';
    // SQLite JSON array join using json_each
    return `(SELECT GROUP_CONCAT(value, ${sep}) FROM json_each(${array}))`;
  }

  arrayUnique(array: string): string {
    // SQLite JSON array unique using json_each and DISTINCT
    return `'[' || (SELECT GROUP_CONCAT('"' || value || '"') FROM (SELECT DISTINCT value FROM json_each(${array}))) || ']'`;
  }

  arrayFlatten(array: string): string {
    // For JSON arrays, just return the array (already flat)
    return `${array}`;
  }

  arrayCompact(array: string): string {
    // Remove null values from JSON array
    return `'[' || (SELECT GROUP_CONCAT('"' || value || '"') FROM json_each(${array}) WHERE value IS NOT NULL AND value != 'null') || ']'`;
  }

  // System Functions
  recordId(): string {
    return `__id`;
  }

  autoNumber(): string {
    return `__auto_number`;
  }

  textAll(value: string): string {
    return `CAST(${value} AS TEXT)`;
  }

  // Binary Operations
  add(left: string, right: string): string {
    return `(${left} + ${right})`;
  }

  subtract(left: string, right: string): string {
    return `(${left} - ${right})`;
  }

  multiply(left: string, right: string): string {
    return `(${left} * ${right})`;
  }

  divide(left: string, right: string): string {
    return `(${left} / ${right})`;
  }

  modulo(left: string, right: string): string {
    return `(${left} % ${right})`;
  }

  // Comparison Operations
  equal(left: string, right: string): string {
    return `(${left} = ${right})`;
  }

  notEqual(left: string, right: string): string {
    return `(${left} <> ${right})`;
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
    return `(${left} & ${right})`;
  }

  // Unary Operations
  unaryMinus(value: string): string {
    return `(-${value})`;
  }

  // Field Reference
  fieldReference(
    _fieldId: string,
    columnName: string,
    _context?: IFormulaConversionContext
  ): string {
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
    return value ? '1' : '0';
  }

  nullLiteral(): string {
    return 'NULL';
  }

  // Utility methods for type conversion and validation
  castToNumber(value: string): string {
    return `CAST(${value} AS REAL)`;
  }

  castToString(value: string): string {
    return `CAST(${value} AS TEXT)`;
  }

  castToBoolean(value: string): string {
    return `CASE WHEN ${value} THEN 1 ELSE 0 END`;
  }

  castToDate(value: string): string {
    return `DATETIME(${value})`;
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
}
