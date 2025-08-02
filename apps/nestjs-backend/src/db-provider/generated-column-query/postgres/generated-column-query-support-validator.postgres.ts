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
    return true;
  }

  average(params: string[]): boolean {
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
    return true;
  }

  search(searchText: string, withinText: string, startNum?: string): boolean {
    return true;
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
    return true;
  }

  substitute(text: string, oldText: string, newText: string, instanceNum?: string): boolean {
    return true;
  }

  lower(text: string): boolean {
    return true;
  }

  upper(text: string): boolean {
    return true;
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
    return true;
  }

  encodeUrlComponent(text: string): boolean {
    return true;
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
    return true;
  }

  datetimeDiff(startDate: string, endDate: string, unit: string): boolean {
    return true;
  }

  datetimeFormat(date: string, format: string): boolean {
    return true;
  }

  datetimeParse(dateString: string, format: string): boolean {
    return true;
  }

  day(date: string): boolean {
    return true;
  }

  fromNow(date: string): boolean {
    // fromNow results are unpredictable due to fixed creation time
    return false;
  }

  hour(date: string): boolean {
    return true;
  }

  isAfter(date1: string, date2: string): boolean {
    return true;
  }

  isBefore(date1: string, date2: string): boolean {
    return true;
  }

  isSame(date1: string, date2: string, unit?: string): boolean {
    return true;
  }

  lastModifiedTime(): boolean {
    // lastModifiedTime is supported
    return true;
  }

  minute(date: string): boolean {
    return true;
  }

  month(date: string): boolean {
    return true;
  }

  second(date: string): boolean {
    return true;
  }

  timestr(date: string): boolean {
    return true;
  }

  toNow(date: string): boolean {
    // toNow results are unpredictable due to fixed creation time
    return false;
  }

  weekNum(date: string): boolean {
    return true;
  }

  weekday(date: string): boolean {
    return true;
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
    return true;
  }

  createdTime(): boolean {
    // createdTime is supported
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

  // System Functions - Supported
  recordId(): boolean {
    // recordId is supported
    return true;
  }

  autoNumber(): boolean {
    // autoNumber is supported
    return true;
  }

  textAll(value: string): boolean {
    return true;
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
