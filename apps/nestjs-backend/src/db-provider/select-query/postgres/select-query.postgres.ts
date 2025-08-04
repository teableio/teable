import { SelectQueryAbstract } from '../select-query.abstract';

/**
 * PostgreSQL-specific implementation of SELECT query functions
 * Converts Teable formula functions to PostgreSQL SQL expressions suitable
 * for use in SELECT statements. Unlike generated columns, these can use
 * mutable functions and have different optimization strategies.
 */
export class SelectQueryPostgres extends SelectQueryAbstract {
  // Numeric Functions
  sum(params: string[]): string {
    // In SELECT context, we can use window functions and aggregates more freely
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

  stringConcat(left: string, right: string): string {
    return `CONCAT(${left}, ${right})`;
  }

  find(searchText: string, withinText: string, startNum?: string): string {
    if (startNum) {
      return `POSITION(${searchText} IN SUBSTRING(${withinText} FROM ${startNum}::integer)) + ${startNum}::integer - 1`;
    }
    return `POSITION(${searchText} IN ${withinText})`;
  }

  search(searchText: string, withinText: string, startNum?: string): string {
    // Similar to find but case-insensitive
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
    return `${date}::timestamp + INTERVAL '${count} ${unit}'`;
  }

  datestr(date: string): string {
    return `${date}::date::text`;
  }

  datetimeDiff(startDate: string, endDate: string, unit: string): string {
    return `EXTRACT(${unit} FROM ${endDate}::timestamp - ${startDate}::timestamp)`;
  }

  datetimeFormat(date: string, format: string): string {
    return `TO_CHAR(${date}::timestamp, ${format})`;
  }

  datetimeParse(dateString: string, format: string): string {
    return `TO_TIMESTAMP(${dateString}, ${format})`;
  }

  day(date: string): string {
    return `EXTRACT(DAY FROM ${date}::timestamp)::int`;
  }

  fromNow(date: string): string {
    return `EXTRACT(EPOCH FROM (NOW() - ${date}::timestamp))`;
  }

  hour(date: string): string {
    return `EXTRACT(HOUR FROM ${date}::timestamp)::int`;
  }

  isAfter(date1: string, date2: string): string {
    return `${date1}::timestamp > ${date2}::timestamp`;
  }

  isBefore(date1: string, date2: string): string {
    return `${date1}::timestamp < ${date2}::timestamp`;
  }

  isSame(date1: string, date2: string, unit?: string): string {
    if (unit) {
      return `DATE_TRUNC('${unit}', ${date1}::timestamp) = DATE_TRUNC('${unit}', ${date2}::timestamp)`;
    }
    return `${date1}::timestamp = ${date2}::timestamp`;
  }

  lastModifiedTime(): string {
    // This would typically reference a system column
    return `"__last_modified_time"`;
  }

  minute(date: string): string {
    return `EXTRACT(MINUTE FROM ${date}::timestamp)::int`;
  }

  month(date: string): string {
    return `EXTRACT(MONTH FROM ${date}::timestamp)::int`;
  }

  second(date: string): string {
    return `EXTRACT(SECOND FROM ${date}::timestamp)::int`;
  }

  timestr(date: string): string {
    return `${date}::time::text`;
  }

  toNow(date: string): string {
    return `EXTRACT(EPOCH FROM (${date}::timestamp - NOW()))`;
  }

  weekNum(date: string): string {
    return `EXTRACT(WEEK FROM ${date}::timestamp)::int`;
  }

  weekday(date: string): string {
    return `EXTRACT(DOW FROM ${date}::timestamp)::int`;
  }

  workday(startDate: string, days: string): string {
    // Simplified implementation - would need more complex logic for actual workdays
    return `${startDate}::date + INTERVAL '${days} days'`;
  }

  workdayDiff(startDate: string, endDate: string): string {
    // Simplified implementation
    return `${endDate}::date - ${startDate}::date`;
  }

  year(date: string): string {
    return `EXTRACT(YEAR FROM ${date}::timestamp)::int`;
  }

  createdTime(): string {
    // This would typically reference a system column
    return `"__created_time"`;
  }

  // Logical Functions
  if(condition: string, valueIfTrue: string, valueIfFalse: string): string {
    return `CASE WHEN ${condition} THEN ${valueIfTrue} ELSE ${valueIfFalse} END`;
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
    return `''`;
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
    return `COUNT(${this.joinParams(params)})`;
  }

  countA(params: string[]): string {
    return `COUNT(${this.joinParams(params.map((p) => `CASE WHEN ${p} IS NOT NULL THEN 1 END`))})`;
  }

  countAll(_value: string): string {
    return `COUNT(*)`;
  }

  arrayJoin(array: string, separator?: string): string {
    const sep = separator || `','`;
    // Handle JSON arrays by converting to text and joining
    return `(
      SELECT string_agg(
        CASE
          WHEN json_typeof(value) = 'array' THEN value::text
          ELSE value::text
        END,
        ${sep}
      )
      FROM json_array_elements(${array})
    )`;
  }

  arrayUnique(array: string): string {
    // Handle JSON arrays by deduplicating
    return `ARRAY(
      SELECT DISTINCT value::text
      FROM json_array_elements(${array})
    )`;
  }

  arrayFlatten(array: string): string {
    // Flatten nested JSON arrays - for now just convert to text array
    return `ARRAY(
      SELECT value::text
      FROM json_array_elements(${array})
    )`;
  }

  arrayCompact(array: string): string {
    // Remove null values from JSON array
    return `ARRAY(
      SELECT value::text
      FROM json_array_elements(${array})
      WHERE value IS NOT NULL AND value::text != 'null'
    )`;
  }

  // System Functions
  recordId(): string {
    // This would typically reference the primary key
    return `__id`;
  }

  autoNumber(): string {
    // This would typically reference an auto-increment column
    return `__auto_number`;
  }

  textAll(value: string): string {
    return `${value}::text`;
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
    return `(${left}::integer & ${right}::integer)`;
  }

  // Unary Operations
  unaryMinus(value: string): string {
    return `(-${value})`;
  }

  // Field Reference
  fieldReference(_fieldId: string, columnName: string, _context?: undefined): string {
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
}
