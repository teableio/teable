import type {
  IFormulaConversionContext,
  IGeneratedColumnQuerySupportValidator,
} from '@teable/core';

/**
 * PostgreSQL-specific implementation for validating generated column function support
 * Returns true for functions that can be safely converted to PostgreSQL SQL expressions
 * suitable for use in generated columns, false for unsupported functions.
 */
export class GeneratedColumnQuerySupportValidatorPostgres
  implements IGeneratedColumnQuerySupportValidator
{
  private context?: IFormulaConversionContext;

  setContext(context: IFormulaConversionContext): void {
    this.context = context;
  }

  // Numeric Functions - PostgreSQL supports all basic numeric functions
  sum(params: string[]): boolean {
    // Use addition instead of SUM() aggregation function
    return true;
  }

  average(params: string[]): boolean {
    // Use addition and division instead of AVG() aggregation function
    return true;
  }

  max(params: string[]): boolean {
    return true;
  }

  min(params: string[]): boolean {
    return true;
  }

  round(value: string, precision?: string): boolean {
    return true;
  }

  roundUp(value: string, precision?: string): boolean {
    return true;
  }

  roundDown(value: string, precision?: string): boolean {
    return true;
  }

  ceiling(value: string): boolean {
    return true;
  }

  floor(value: string): boolean {
    return true;
  }

  even(value: string): boolean {
    return true;
  }

  odd(value: string): boolean {
    return true;
  }

  int(value: string): boolean {
    return true;
  }

  abs(value: string): boolean {
    return true;
  }

  sqrt(value: string): boolean {
    return true;
  }

  power(base: string, exponent: string): boolean {
    return true;
  }

  exp(value: string): boolean {
    return true;
  }

  log(value: string, base?: string): boolean {
    return true;
  }

  mod(dividend: string, divisor: string): boolean {
    return true;
  }

  value(text: string): boolean {
    return true;
  }

  // Text Functions - PostgreSQL supports most text functions
  concatenate(params: string[]): boolean {
    return true;
  }

  stringConcat(left: string, right: string): boolean {
    return true;
  }

  find(searchText: string, withinText: string, startNum?: string): boolean {
    // POSITION function requires collation in PostgreSQL
    return false;
  }

  search(searchText: string, withinText: string, startNum?: string): boolean {
    // POSITION function requires collation in PostgreSQL
    return false;
  }

  mid(text: string, startNum: string, numChars: string): boolean {
    return true;
  }

  left(text: string, numChars: string): boolean {
    return true;
  }

  right(text: string, numChars: string): boolean {
    return true;
  }

  replace(oldText: string, startNum: string, numChars: string, newText: string): boolean {
    return true;
  }

  regexpReplace(text: string, pattern: string, replacement: string): boolean {
    // REGEXP_REPLACE is not supported in generated columns
    return false;
  }

  substitute(text: string, oldText: string, newText: string, instanceNum?: string): boolean {
    // REPLACE function requires collation in PostgreSQL
    return false;
  }

  lower(text: string): boolean {
    // LOWER function requires collation for string literals in PostgreSQL
    // Only supported when used with column references
    return false;
  }

  upper(text: string): boolean {
    // UPPER function requires collation for string literals in PostgreSQL
    // Only supported when used with column references
    return false;
  }

  rept(text: string, numTimes: string): boolean {
    return true;
  }

  trim(text: string): boolean {
    return true;
  }

  len(text: string): boolean {
    return true;
  }

  t(value: string): boolean {
    // T function implementation doesn't work correctly in PostgreSQL
    return false;
  }

  encodeUrlComponent(text: string): boolean {
    // URL encoding is not supported in PostgreSQL generated columns
    return false;
  }

  // DateTime Functions - Most are supported, some have limitations but are still usable
  now(): boolean {
    // now() is supported but results are fixed at creation time
    return true;
  }

  today(): boolean {
    // today() is supported but results are fixed at creation time
    return true;
  }

  dateAdd(date: string, count: string, unit: string): boolean {
    return true;
  }

  datestr(date: string): boolean {
    // DATESTR with column references is not immutable in PostgreSQL
    return false;
  }

  datetimeDiff(startDate: string, endDate: string, unit: string): boolean {
    // DATETIME_DIFF is not immutable in PostgreSQL
    return false;
  }

  datetimeFormat(date: string, format: string): boolean {
    // DATETIME_FORMAT is not immutable in PostgreSQL
    return false;
  }

  datetimeParse(dateString: string, format: string): boolean {
    // DATETIME_PARSE is not immutable in PostgreSQL
    return false;
  }

  day(date: string): boolean {
    // DAY with column references is not immutable in PostgreSQL
    return false;
  }

  fromNow(date: string): boolean {
    // fromNow results are unpredictable due to fixed creation time
    return false;
  }

  hour(date: string): boolean {
    // HOUR with column references is not immutable in PostgreSQL
    return false;
  }

  isAfter(date1: string, date2: string): boolean {
    // IS_AFTER is not immutable in PostgreSQL
    return false;
  }

  isBefore(date1: string, date2: string): boolean {
    // IS_BEFORE is not immutable in PostgreSQL
    return false;
  }

  isSame(date1: string, date2: string, unit?: string): boolean {
    // IS_SAME is not immutable in PostgreSQL
    return false;
  }

  lastModifiedTime(): boolean {
    // lastModifiedTime references system column, supported
    return true;
  }

  minute(date: string): boolean {
    // MINUTE with column references is not immutable in PostgreSQL
    return false;
  }

  month(date: string): boolean {
    // MONTH with column references is not immutable in PostgreSQL
    return false;
  }

  second(date: string): boolean {
    // SECOND with column references is not immutable in PostgreSQL
    return false;
  }

  timestr(date: string): boolean {
    // TIMESTR with column references is not immutable in PostgreSQL
    return false;
  }

  toNow(date: string): boolean {
    // toNow results are unpredictable due to fixed creation time
    return false;
  }

  weekNum(date: string): boolean {
    // WEEKNUM with column references is not immutable in PostgreSQL
    return false;
  }

  weekday(date: string): boolean {
    // WEEKDAY with column references is not immutable in PostgreSQL
    return false;
  }

  workday(startDate: string, days: string): boolean {
    // Complex weekend-skipping logic not implemented
    return false;
  }

  workdayDiff(startDate: string, endDate: string): boolean {
    // Complex business day calculation not implemented
    return false;
  }

  year(date: string): boolean {
    // YEAR with column references is not immutable in PostgreSQL
    return false;
  }

  createdTime(): boolean {
    // createdTime references system column, supported
    return true;
  }

  // Logical Functions - All supported
  if(condition: string, valueIfTrue: string, valueIfFalse: string): boolean {
    return true;
  }

  and(params: string[]): boolean {
    return true;
  }

  or(params: string[]): boolean {
    return true;
  }

  not(value: string): boolean {
    return true;
  }

  xor(params: string[]): boolean {
    return true;
  }

  blank(): boolean {
    return true;
  }

  error(message: string): boolean {
    // Cannot throw errors in generated column definitions
    return false;
  }

  isError(value: string): boolean {
    // Cannot detect runtime errors in generated columns
    return false;
  }

  switch(
    expression: string,
    cases: Array<{ case: string; result: string }>,
    defaultResult?: string
  ): boolean {
    return true;
  }

  // Array Functions - PostgreSQL supports basic array operations
  count(params: string[]): boolean {
    return true;
  }

  countA(params: string[]): boolean {
    return true;
  }

  countAll(value: string): boolean {
    return true;
  }

  arrayJoin(array: string, separator?: string): boolean {
    // JSONB vs Array type mismatch issue
    return false;
  }

  arrayUnique(array: string): boolean {
    // Uses subqueries not allowed in generated columns
    return false;
  }

  arrayFlatten(array: string): boolean {
    // Uses subqueries not allowed in generated columns
    return false;
  }

  arrayCompact(array: string): boolean {
    // Uses subqueries not allowed in generated columns
    return false;
  }

  // System Functions - Supported (reference system columns)
  recordId(): boolean {
    // recordId references system column, supported
    return true;
  }

  autoNumber(): boolean {
    // autoNumber references system column, supported
    return true;
  }

  textAll(value: string): boolean {
    // textAll with non-array types causes function mismatch
    return false;
  }

  // Binary Operations - All supported
  add(left: string, right: string): boolean {
    return true;
  }

  subtract(left: string, right: string): boolean {
    return true;
  }

  multiply(left: string, right: string): boolean {
    return true;
  }

  divide(left: string, right: string): boolean {
    return true;
  }

  modulo(left: string, right: string): boolean {
    return true;
  }

  // Comparison Operations - All supported
  equal(left: string, right: string): boolean {
    return true;
  }

  notEqual(left: string, right: string): boolean {
    return true;
  }

  greaterThan(left: string, right: string): boolean {
    return true;
  }

  lessThan(left: string, right: string): boolean {
    return true;
  }

  greaterThanOrEqual(left: string, right: string): boolean {
    return true;
  }

  lessThanOrEqual(left: string, right: string): boolean {
    return true;
  }

  // Logical Operations - All supported
  logicalAnd(left: string, right: string): boolean {
    return true;
  }

  logicalOr(left: string, right: string): boolean {
    return true;
  }

  bitwiseAnd(left: string, right: string): boolean {
    return true;
  }

  // Unary Operations - All supported
  unaryMinus(value: string): boolean {
    return true;
  }

  // Field Reference - Supported
  fieldReference(
    fieldId: string,
    columnName: string,
    context?: IFormulaConversionContext
  ): boolean {
    return true;
  }

  // Literals - All supported
  stringLiteral(value: string): boolean {
    return true;
  }

  numberLiteral(value: number): boolean {
    return true;
  }

  booleanLiteral(value: boolean): boolean {
    return true;
  }

  nullLiteral(): boolean {
    return true;
  }

  // Utility methods - All supported
  castToNumber(value: string): boolean {
    return true;
  }

  castToString(value: string): boolean {
    return true;
  }

  castToBoolean(value: string): boolean {
    return true;
  }

  castToDate(value: string): boolean {
    return true;
  }

  // Handle null values and type checking - All supported
  isNull(value: string): boolean {
    return true;
  }

  coalesce(params: string[]): boolean {
    return true;
  }

  // Parentheses for grouping - Supported
  parentheses(expression: string): boolean {
    return true;
  }
}
