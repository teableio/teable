import type { CellValueType } from '@teable/core';

/**
 * Interface for database-specific formula function implementations
 * Each database provider (PostgreSQL, SQLite) should implement this interface
 * to provide SQL translations for Teable formula functions
 */
export interface IFormulaQueryInterface {
  // Numeric Functions
  sum(params: string[]): string;
  average(params: string[]): string;
  max(params: string[]): string;
  min(params: string[]): string;
  round(value: string, precision?: string): string;
  roundUp(value: string, precision?: string): string;
  roundDown(value: string, precision?: string): string;
  ceiling(value: string): string;
  floor(value: string): string;
  even(value: string): string;
  odd(value: string): string;
  int(value: string): string;
  abs(value: string): string;
  sqrt(value: string): string;
  power(base: string, exponent: string): string;
  exp(value: string): string;
  log(value: string, base?: string): string;
  mod(dividend: string, divisor: string): string;
  value(text: string): string;

  // Text Functions
  concatenate(params: string[]): string;
  find(searchText: string, withinText: string, startNum?: string): string;
  search(searchText: string, withinText: string, startNum?: string): string;
  mid(text: string, startNum: string, numChars: string): string;
  left(text: string, numChars: string): string;
  right(text: string, numChars: string): string;
  replace(oldText: string, startNum: string, numChars: string, newText: string): string;
  regexpReplace(text: string, pattern: string, replacement: string): string;
  substitute(text: string, oldText: string, newText: string, instanceNum?: string): string;
  lower(text: string): string;
  upper(text: string): string;
  rept(text: string, numTimes: string): string;
  trim(text: string): string;
  len(text: string): string;
  t(value: string): string;
  encodeUrlComponent(text: string): string;

  // DateTime Functions
  now(): string;
  today(): string;
  dateAdd(date: string, count: string, unit: string): string;
  datestr(date: string): string;
  datetimeDiff(startDate: string, endDate: string, unit: string): string;
  datetimeFormat(date: string, format: string): string;
  datetimeParse(dateString: string, format: string): string;
  day(date: string): string;
  fromNow(date: string): string;
  hour(date: string): string;
  isAfter(date1: string, date2: string): string;
  isBefore(date1: string, date2: string): string;
  isSame(date1: string, date2: string, unit?: string): string;
  lastModifiedTime(): string;
  minute(date: string): string;
  month(date: string): string;
  second(date: string): string;
  timestr(date: string): string;
  toNow(date: string): string;
  weekNum(date: string): string;
  weekday(date: string): string;
  workday(startDate: string, days: string): string;
  workdayDiff(startDate: string, endDate: string): string;
  year(date: string): string;
  createdTime(): string;

  // Logical Functions
  if(condition: string, valueIfTrue: string, valueIfFalse: string): string;
  and(params: string[]): string;
  or(params: string[]): string;
  not(value: string): string;
  xor(params: string[]): string;
  blank(): string;
  isError(value: string): string;
  switch(
    expression: string,
    cases: Array<{ case: string; result: string }>,
    defaultResult?: string
  ): string;

  // Array Functions
  count(params: string[]): string;
  countA(params: string[]): string;
  countAll(value: string): string;
  arrayJoin(array: string, separator?: string): string;
  arrayUnique(array: string): string;
  arrayFlatten(array: string): string;
  arrayCompact(array: string): string;

  // System Functions
  recordId(): string;
  autoNumber(): string;
  textAll(value: string): string;

  // Binary Operations
  add(left: string, right: string): string;
  subtract(left: string, right: string): string;
  multiply(left: string, right: string): string;
  divide(left: string, right: string): string;
  modulo(left: string, right: string): string;

  // Comparison Operations
  equal(left: string, right: string): string;
  notEqual(left: string, right: string): string;
  greaterThan(left: string, right: string): string;
  lessThan(left: string, right: string): string;
  greaterThanOrEqual(left: string, right: string): string;
  lessThanOrEqual(left: string, right: string): string;

  // Logical Operations
  logicalAnd(left: string, right: string): string;
  logicalOr(left: string, right: string): string;
  bitwiseAnd(left: string, right: string): string;

  // Unary Operations
  unaryMinus(value: string): string;

  // Field Reference
  fieldReference(fieldId: string, columnName: string): string;

  // Literals
  stringLiteral(value: string): string;
  numberLiteral(value: number): string;
  booleanLiteral(value: boolean): string;
  nullLiteral(): string;

  // Utility methods for type conversion and validation
  castToNumber(value: string): string;
  castToString(value: string): string;
  castToBoolean(value: string): string;
  castToDate(value: string): string;

  // Handle null values and type checking
  isNull(value: string): string;
  coalesce(params: string[]): string;

  // Parentheses for grouping
  parentheses(expression: string): string;
}

/**
 * Context information for formula conversion
 */
export interface IFormulaConversionContext {
  fieldMap: { [fieldId: string]: { columnName: string } };
  timeZone?: string;
}

/**
 * Result of formula conversion
 */
export interface IFormulaConversionResult {
  sql: string;
  dependencies: string[]; // field IDs that this formula depends on
}
