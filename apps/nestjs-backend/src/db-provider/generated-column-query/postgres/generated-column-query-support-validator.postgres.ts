import type {
  IFormulaConversionContext,
  IGeneratedColumnQuerySupportValidator,
} from '../../../features/record/query-builder/sql-conversion.visitor';

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
  sum(_params: string[]): boolean {
    // Use addition instead of SUM() aggregation function
    return true;
  }

  average(_params: string[]): boolean {
    // Use addition and division instead of AVG() aggregation function
    return true;
  }

  max(_params: string[]): boolean {
    return true;
  }

  min(_params: string[]): boolean {
    return true;
  }

  round(_value: string, _precision?: string): boolean {
    return true;
  }

  roundUp(_value: string, _precision?: string): boolean {
    return true;
  }

  roundDown(_value: string, _precision?: string): boolean {
    return true;
  }

  ceiling(_value: string): boolean {
    return true;
  }

  floor(_value: string): boolean {
    return true;
  }

  even(_value: string): boolean {
    return true;
  }

  odd(_value: string): boolean {
    return true;
  }

  int(_value: string): boolean {
    return true;
  }

  abs(_value: string): boolean {
    return true;
  }

  sqrt(_value: string): boolean {
    return true;
  }

  power(_base: string, _exponent: string): boolean {
    return true;
  }

  exp(_value: string): boolean {
    return true;
  }

  log(_value: string, _base?: string): boolean {
    return true;
  }

  mod(_dividend: string, _divisor: string): boolean {
    return true;
  }

  value(_text: string): boolean {
    return true;
  }

  // Text Functions - PostgreSQL supports most text functions
  concatenate(_params: string[]): boolean {
    return true;
  }

  stringConcat(_left: string, _right: string): boolean {
    return true;
  }

  find(_searchText: string, _withinText: string, _startNum?: string): boolean {
    // POSITION function requires collation in PostgreSQL
    return false;
  }

  search(_searchText: string, _withinText: string, _startNum?: string): boolean {
    // POSITION function requires collation in PostgreSQL
    return false;
  }

  mid(_text: string, _startNum: string, _numChars: string): boolean {
    return true;
  }

  left(_text: string, _numChars: string): boolean {
    return true;
  }

  right(_text: string, _numChars: string): boolean {
    return true;
  }

  replace(_oldText: string, _startNum: string, _numChars: string, _newText: string): boolean {
    return true;
  }

  regexpReplace(_text: string, _pattern: string, _replacement: string): boolean {
    // REGEXP_REPLACE is not supported in generated columns
    return false;
  }

  substitute(_text: string, _oldText: string, _newText: string, _instanceNum?: string): boolean {
    // REPLACE function requires collation in PostgreSQL
    return false;
  }

  lower(_text: string): boolean {
    // LOWER function requires collation for string literals in PostgreSQL
    // Only supported when used with column references
    return false;
  }

  upper(_text: string): boolean {
    // UPPER function requires collation for string literals in PostgreSQL
    // Only supported when used with column references
    return false;
  }

  rept(_text: string, _numTimes: string): boolean {
    return true;
  }

  trim(_text: string): boolean {
    return true;
  }

  len(_text: string): boolean {
    return true;
  }

  t(_value: string): boolean {
    // T function implementation doesn't work correctly in PostgreSQL
    return false;
  }

  encodeUrlComponent(_text: string): boolean {
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

  dateAdd(_date: string, _count: string, _unit: string): boolean {
    return true;
  }

  datestr(_date: string): boolean {
    // DATESTR with column references is not immutable in PostgreSQL
    return false;
  }

  datetimeDiff(_startDate: string, _endDate: string, _unit: string): boolean {
    // DATETIME_DIFF is not immutable in PostgreSQL
    return false;
  }

  datetimeFormat(_date: string, _format: string): boolean {
    // DATETIME_FORMAT is not immutable in PostgreSQL
    return false;
  }

  datetimeParse(_dateString: string, _format?: string): boolean {
    // DATETIME_PARSE is not immutable in PostgreSQL
    return false;
  }

  day(_date: string): boolean {
    // DAY with column references is not immutable in PostgreSQL
    return false;
  }

  fromNow(_date: string): boolean {
    // fromNow results are unpredictable due to fixed creation time
    return false;
  }

  hour(_date: string): boolean {
    // HOUR with column references is not immutable in PostgreSQL
    return false;
  }

  isAfter(_date1: string, _date2: string): boolean {
    // IS_AFTER is not immutable in PostgreSQL
    return false;
  }

  isBefore(_date1: string, _date2: string): boolean {
    // IS_BEFORE is not immutable in PostgreSQL
    return false;
  }

  isSame(_date1: string, _date2: string, _unit?: string): boolean {
    // IS_SAME is not immutable in PostgreSQL
    return false;
  }

  lastModifiedTime(): boolean {
    return false;
  }

  minute(_date: string): boolean {
    // MINUTE with column references is not immutable in PostgreSQL
    return false;
  }

  month(_date: string): boolean {
    // MONTH with column references is not immutable in PostgreSQL
    return false;
  }

  second(_date: string): boolean {
    // SECOND with column references is not immutable in PostgreSQL
    return false;
  }

  timestr(_date: string): boolean {
    // TIMESTR with column references is not immutable in PostgreSQL
    return false;
  }

  toNow(_date: string): boolean {
    // toNow results are unpredictable due to fixed creation time
    return false;
  }

  weekNum(_date: string): boolean {
    // WEEKNUM with column references is not immutable in PostgreSQL
    return false;
  }

  weekday(_date: string): boolean {
    // WEEKDAY with column references is not immutable in PostgreSQL
    return false;
  }

  workday(_startDate: string, _days: string): boolean {
    // Complex weekend-skipping logic not implemented
    return false;
  }

  workdayDiff(_startDate: string, _endDate: string): boolean {
    // Complex business day calculation not implemented
    return false;
  }

  year(_date: string): boolean {
    // YEAR with column references is not immutable in PostgreSQL
    return false;
  }

  createdTime(): boolean {
    return false;
  }

  // Logical Functions - IF fallback to computed evaluation (not immutable-safe).
  // Example: `IF({LinkField}, 1, 0)` dereferences JSON arrays from link cells and
  // needs runtime truthiness checks; the generated expression is not immutable,
  // so we force evaluation in the computed path instead of a generated column.
  if(_condition: string, _valueIfTrue: string, _valueIfFalse: string): boolean {
    return false;
  }

  and(_params: string[]): boolean {
    return true;
  }

  or(_params: string[]): boolean {
    return true;
  }

  not(_value: string): boolean {
    return true;
  }

  xor(_params: string[]): boolean {
    return true;
  }

  blank(): boolean {
    return true;
  }

  error(_message: string): boolean {
    // Cannot throw errors in generated column definitions
    return false;
  }

  isError(_value: string): boolean {
    // Cannot detect runtime errors in generated columns
    return false;
  }

  switch(
    _expression: string,
    _cases: Array<{ case: string; result: string }>,
    _defaultResult?: string
  ): boolean {
    return true;
  }

  // Array Functions - PostgreSQL supports basic array operations
  count(_params: string[]): boolean {
    return true;
  }

  countA(_params: string[]): boolean {
    return true;
  }

  countAll(_value: string): boolean {
    return true;
  }

  arrayJoin(_array: string, _separator?: string): boolean {
    // JSONB vs Array type mismatch issue
    return false;
  }

  arrayUnique(_array: string): boolean {
    // Uses subqueries not allowed in generated columns
    return false;
  }

  arrayFlatten(_array: string): boolean {
    // Uses subqueries not allowed in generated columns
    return false;
  }

  arrayCompact(_array: string): boolean {
    // Uses subqueries not allowed in generated columns
    return false;
  }

  // System Functions - Supported (reference system columns)
  recordId(): boolean {
    return false;
  }

  autoNumber(): boolean {
    return false;
  }

  textAll(_value: string): boolean {
    // textAll with non-array types causes function mismatch
    return false;
  }

  // Binary Operations - All supported
  add(_left: string, _right: string): boolean {
    return true;
  }

  subtract(_left: string, _right: string): boolean {
    return true;
  }

  multiply(_left: string, _right: string): boolean {
    return true;
  }

  divide(_left: string, _right: string): boolean {
    return true;
  }

  modulo(_left: string, _right: string): boolean {
    return true;
  }

  // Comparison Operations - All supported
  equal(_left: string, _right: string): boolean {
    return true;
  }

  notEqual(_left: string, _right: string): boolean {
    return true;
  }

  greaterThan(_left: string, _right: string): boolean {
    return true;
  }

  lessThan(_left: string, _right: string): boolean {
    return true;
  }

  greaterThanOrEqual(_left: string, _right: string): boolean {
    return true;
  }

  lessThanOrEqual(_left: string, _right: string): boolean {
    return true;
  }

  // Logical Operations - All supported
  logicalAnd(_left: string, _right: string): boolean {
    return true;
  }

  logicalOr(_left: string, _right: string): boolean {
    return true;
  }

  bitwiseAnd(_left: string, _right: string): boolean {
    return true;
  }

  // Unary Operations - All supported
  unaryMinus(_value: string): boolean {
    return true;
  }

  // Field Reference - Supported
  fieldReference(_fieldId: string, _columnName: string): boolean {
    return true;
  }

  // Literals - All supported
  stringLiteral(_value: string): boolean {
    return true;
  }

  numberLiteral(_value: number): boolean {
    return true;
  }

  booleanLiteral(_value: boolean): boolean {
    return true;
  }

  nullLiteral(): boolean {
    return true;
  }

  // Utility methods - All supported
  castToNumber(_value: string): boolean {
    return true;
  }

  castToString(_value: string): boolean {
    return true;
  }

  castToBoolean(_value: string): boolean {
    return true;
  }

  castToDate(_value: string): boolean {
    return true;
  }

  // Handle null values and type checking - All supported
  isNull(_value: string): boolean {
    return true;
  }

  coalesce(_params: string[]): boolean {
    return true;
  }

  // Parentheses for grouping - Supported
  parentheses(_expression: string): boolean {
    return true;
  }
}
