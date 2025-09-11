import { SelectQueryAbstract } from '../select-query.abstract';

/**
 * PostgreSQL-specific implementation of SELECT query functions
 * Converts Teable formula functions to PostgreSQL SQL expressions suitable
 * for use in SELECT statements. Unlike generated columns, these can use
 * mutable functions and have different optimization strategies.
 */
export class SelectQueryPostgres extends SelectQueryAbstract {
  private toNumericSafe(expr: string): string {
    // Safely coerce any scalar to numeric:
    // - Strip everything except digits, sign, decimal point
    // - Map empty string to NULL to avoid casting errors
    // This avoids constant-cast failures like `'x'::numeric` at plan time.
    return `NULLIF(REGEXP_REPLACE((${expr})::text, '[^0-9.+-]', '', 'g'), '')::numeric`;
  }
  private tzWrap(date: string): string {
    const tz = this.context?.timeZone as string | undefined;
    if (!tz) {
      // Default behavior: interpret as timestamp without timezone
      return `${date}::timestamp`;
    }
    // Sanitize single quotes to prevent SQL issues
    const safeTz = tz.replace(/'/g, "''");
    // Interpret input as timestamptz if it has offset and convert to target timezone
    // AT TIME ZONE returns timestamp without time zone in that zone
    return `${date}::timestamptz AT TIME ZONE '${safeTz}'`;
  }
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
    // CONCAT automatically handles type conversion in PostgreSQL
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
    const cleanUnit = unit.replace(/^'|'$/g, '');
    return `${this.tzWrap(date)} + INTERVAL '${count} ${cleanUnit}'`;
  }

  datestr(date: string): string {
    return `${this.tzWrap(date)}::date::text`;
  }

  datetimeDiff(startDate: string, endDate: string, unit: string): string {
    const cleanUnit = unit.replace(/^'|'$/g, '').toLowerCase();
    const diffSeconds = `EXTRACT(EPOCH FROM (${this.tzWrap(endDate)} - ${this.tzWrap(startDate)}))`;
    return `CASE
      WHEN '${cleanUnit}' IN ('day','days') THEN (${diffSeconds}) / 86400
      WHEN '${cleanUnit}' IN ('hour','hours') THEN (${diffSeconds}) / 3600
      WHEN '${cleanUnit}' IN ('minute','minutes') THEN (${diffSeconds}) / 60
      WHEN '${cleanUnit}' IN ('second','seconds') THEN (${diffSeconds})
      ELSE (${diffSeconds}) / 86400
    END`;
  }

  datetimeFormat(date: string, format: string): string {
    return `TO_CHAR(${this.tzWrap(date)}, ${format})`;
  }

  datetimeParse(dateString: string, format: string): string {
    return `TO_TIMESTAMP(${dateString}, ${format})`;
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
      return `DATE_TRUNC('${unit}', ${this.tzWrap(date1)}) = DATE_TRUNC('${unit}', ${this.tzWrap(date2)})`;
    }
    return `${this.tzWrap(date1)} = ${this.tzWrap(date2)}`;
  }

  lastModifiedTime(): string {
    // This would typically reference a system column
    return `"__last_modified_time"`;
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
    return `${this.tzWrap(date)}::time::text`;
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
    return `${this.tzWrap(startDate)}::date + INTERVAL '${days} days'`;
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
    return `"__created_time"`;
  }

  // Logical Functions
  if(condition: string, valueIfTrue: string, valueIfFalse: string): string {
    // Handle JSON values in conditions by checking if they are not null and not JSON null
    // This is needed for link fields that return JSON objects
    const booleanCondition = `(${condition} IS NOT NULL AND ${condition}::text != 'null')`;
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
    const l = this.toNumericSafe(left);
    const r = this.toNumericSafe(right);
    return `(${l} * ${r})`;
  }

  divide(left: string, right: string): string {
    const l = this.toNumericSafe(left);
    const r = this.toNumericSafe(right);
    return `(${l} / ${r})`;
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
    return `(-${value})`;
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
}
