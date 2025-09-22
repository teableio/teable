import type { FieldCore } from '../models/field/field';

/**
 * Generic field map type for formula conversion contexts
 */
export type IFieldMap<T extends FieldCore = FieldCore> = Map<string, T>;

/**
 * Base interface for converting Teable formula functions to database-specific implementations
 * This interface defines the contract for translating Teable functions to database functions
 * with a generic return type to support different use cases (SQL strings, boolean validation, etc.)
 */
export interface ITeableToDbFunctionConverter<TReturn, TContext> {
  // Context management
  setContext(context: TContext): void;
  // Numeric Functions
  sum(params: string[]): TReturn;
  average(params: string[]): TReturn;
  max(params: string[]): TReturn;
  min(params: string[]): TReturn;
  round(value: string, precision?: string): TReturn;
  roundUp(value: string, precision?: string): TReturn;
  roundDown(value: string, precision?: string): TReturn;
  ceiling(value: string): TReturn;
  floor(value: string): TReturn;
  even(value: string): TReturn;
  odd(value: string): TReturn;
  int(value: string): TReturn;
  abs(value: string): TReturn;
  sqrt(value: string): TReturn;
  power(base: string, exponent: string): TReturn;
  exp(value: string): TReturn;
  log(value: string, base?: string): TReturn;
  mod(dividend: string, divisor: string): TReturn;
  value(text: string): TReturn;

  // Text Functions
  concatenate(params: string[]): TReturn;
  stringConcat(left: string, right: string): TReturn;
  find(searchText: string, withinText: string, startNum?: string): TReturn;
  search(searchText: string, withinText: string, startNum?: string): TReturn;
  mid(text: string, startNum: string, numChars: string): TReturn;
  left(text: string, numChars: string): TReturn;
  right(text: string, numChars: string): TReturn;
  replace(oldText: string, startNum: string, numChars: string, newText: string): TReturn;
  regexpReplace(text: string, pattern: string, replacement: string): TReturn;
  substitute(text: string, oldText: string, newText: string, instanceNum?: string): TReturn;
  lower(text: string): TReturn;
  upper(text: string): TReturn;
  rept(text: string, numTimes: string): TReturn;
  trim(text: string): TReturn;
  len(text: string): TReturn;
  t(value: string): TReturn;
  encodeUrlComponent(text: string): TReturn;

  // DateTime Functions
  now(): TReturn;
  today(): TReturn;
  dateAdd(date: string, count: string, unit: string): TReturn;
  datestr(date: string): TReturn;
  datetimeDiff(startDate: string, endDate: string, unit: string): TReturn;
  datetimeFormat(date: string, format: string): TReturn;
  datetimeParse(dateString: string, format?: string): TReturn;
  day(date: string): TReturn;
  fromNow(date: string): TReturn;
  hour(date: string): TReturn;
  isAfter(date1: string, date2: string): TReturn;
  isBefore(date1: string, date2: string): TReturn;
  isSame(date1: string, date2: string, unit?: string): TReturn;
  lastModifiedTime(): TReturn;
  minute(date: string): TReturn;
  month(date: string): TReturn;
  second(date: string): TReturn;
  timestr(date: string): TReturn;
  toNow(date: string): TReturn;
  weekNum(date: string): TReturn;
  weekday(date: string): TReturn;
  workday(startDate: string, days: string): TReturn;
  workdayDiff(startDate: string, endDate: string): TReturn;
  year(date: string): TReturn;
  createdTime(): TReturn;

  // Logical Functions
  if(condition: string, valueIfTrue: string, valueIfFalse: string): TReturn;
  and(params: string[]): TReturn;
  or(params: string[]): TReturn;
  not(value: string): TReturn;
  xor(params: string[]): TReturn;
  blank(): TReturn;
  error(message: string): TReturn;
  isError(value: string): TReturn;
  switch(
    expression: string,
    cases: Array<{ case: string; result: string }>,
    defaultResult?: string
  ): TReturn;

  // Array Functions
  count(params: string[]): TReturn;
  countA(params: string[]): TReturn;
  countAll(value: string): TReturn;
  arrayJoin(array: string, separator?: string): TReturn;
  arrayUnique(array: string): TReturn;
  arrayFlatten(array: string): TReturn;
  arrayCompact(array: string): TReturn;

  // System Functions
  recordId(): TReturn;
  autoNumber(): TReturn;
  textAll(value: string): TReturn;

  // Binary Operations
  add(left: string, right: string): TReturn;
  subtract(left: string, right: string): TReturn;
  multiply(left: string, right: string): TReturn;
  divide(left: string, right: string): TReturn;
  modulo(left: string, right: string): TReturn;

  // Comparison Operations
  equal(left: string, right: string): TReturn;
  notEqual(left: string, right: string): TReturn;
  greaterThan(left: string, right: string): TReturn;
  lessThan(left: string, right: string): TReturn;
  greaterThanOrEqual(left: string, right: string): TReturn;
  lessThanOrEqual(left: string, right: string): TReturn;

  // Logical Operations
  logicalAnd(left: string, right: string): TReturn;
  logicalOr(left: string, right: string): TReturn;
  bitwiseAnd(left: string, right: string): TReturn;

  // Unary Operations
  unaryMinus(value: string): TReturn;

  // Field Reference
  fieldReference(fieldId: string, columnName: string): TReturn;

  // Literals
  stringLiteral(value: string): TReturn;
  numberLiteral(value: number): TReturn;
  booleanLiteral(value: boolean): TReturn;
  nullLiteral(): TReturn;

  // Utility methods for type conversion and validation
  castToNumber(value: string): TReturn;
  castToString(value: string): TReturn;
  castToBoolean(value: string): TReturn;
  castToDate(value: string): TReturn;

  // Handle null values and type checking
  isNull(value: string): TReturn;
  coalesce(params: string[]): TReturn;

  // Parentheses for grouping
  parentheses(expression: string): TReturn;
}
