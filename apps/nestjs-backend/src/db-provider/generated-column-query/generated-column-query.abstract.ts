import type {
  IFormulaConversionContext,
  IGeneratedColumnQueryInterface,
} from '../../features/record/query-builder/sql-conversion.visitor';

/**
 * Abstract base class for generated column query implementations
 * Provides common functionality and default implementations for converting
 * Teable formula expressions to database-specific SQL suitable for generated columns
 */
export abstract class GeneratedColumnQueryAbstract implements IGeneratedColumnQueryInterface {
  /** Current conversion context */
  protected context?: IFormulaConversionContext;

  /** Set the conversion context */
  setContext(context: IFormulaConversionContext): void {
    this.context = context;
  }

  /** Check if we're in a generated column context */
  protected get isGeneratedColumnContext(): boolean {
    return this.context?.isGeneratedColumn ?? false;
  }
  // Numeric Functions
  abstract sum(params: string[]): string;
  abstract average(params: string[]): string;
  abstract max(params: string[]): string;
  abstract min(params: string[]): string;
  abstract round(value: string, precision?: string): string;
  abstract roundUp(value: string, precision?: string): string;
  abstract roundDown(value: string, precision?: string): string;
  abstract ceiling(value: string): string;
  abstract floor(value: string): string;
  abstract even(value: string): string;
  abstract odd(value: string): string;
  abstract int(value: string): string;
  abstract abs(value: string): string;
  abstract sqrt(value: string): string;
  abstract power(base: string, exponent: string): string;
  abstract exp(value: string): string;
  abstract log(value: string, base?: string): string;
  abstract mod(dividend: string, divisor: string): string;
  abstract value(text: string): string;

  // Text Functions
  abstract concatenate(params: string[]): string;
  abstract stringConcat(left: string, right: string): string;
  abstract find(searchText: string, withinText: string, startNum?: string): string;
  abstract search(searchText: string, withinText: string, startNum?: string): string;
  abstract mid(text: string, startNum: string, numChars: string): string;
  abstract left(text: string, numChars: string): string;
  abstract right(text: string, numChars: string): string;
  abstract replace(oldText: string, startNum: string, numChars: string, newText: string): string;
  abstract regexpReplace(text: string, pattern: string, replacement: string): string;
  abstract substitute(text: string, oldText: string, newText: string, instanceNum?: string): string;
  abstract lower(text: string): string;
  abstract upper(text: string): string;
  abstract rept(text: string, numTimes: string): string;
  abstract trim(text: string): string;
  abstract len(text: string): string;
  abstract t(value: string): string;
  abstract encodeUrlComponent(text: string): string;

  // DateTime Functions
  abstract now(): string;
  abstract today(): string;
  abstract dateAdd(date: string, count: string, unit: string): string;
  abstract datestr(date: string): string;
  abstract datetimeDiff(startDate: string, endDate: string, unit: string): string;
  abstract datetimeFormat(date: string, format: string): string;
  abstract datetimeParse(dateString: string, format?: string): string;
  abstract day(date: string): string;
  abstract fromNow(date: string): string;
  abstract hour(date: string): string;
  abstract isAfter(date1: string, date2: string): string;
  abstract isBefore(date1: string, date2: string): string;
  abstract isSame(date1: string, date2: string, unit?: string): string;
  abstract lastModifiedTime(): string;
  abstract minute(date: string): string;
  abstract month(date: string): string;
  abstract second(date: string): string;
  abstract timestr(date: string): string;
  abstract toNow(date: string): string;
  abstract weekNum(date: string): string;
  abstract weekday(date: string): string;
  abstract workday(startDate: string, days: string): string;
  abstract workdayDiff(startDate: string, endDate: string): string;
  abstract year(date: string): string;
  abstract createdTime(): string;

  // Logical Functions
  abstract if(condition: string, valueIfTrue: string, valueIfFalse: string): string;
  abstract and(params: string[]): string;
  abstract or(params: string[]): string;
  abstract not(value: string): string;
  abstract xor(params: string[]): string;
  abstract blank(): string;
  abstract error(message: string): string;
  abstract isError(value: string): string;
  abstract switch(
    expression: string,
    cases: Array<{ case: string; result: string }>,
    defaultResult?: string
  ): string;

  // Array Functions
  abstract count(params: string[]): string;
  abstract countA(params: string[]): string;
  abstract countAll(value: string): string;
  abstract arrayJoin(array: string, separator?: string): string;
  abstract arrayUnique(array: string): string;
  abstract arrayFlatten(array: string): string;
  abstract arrayCompact(array: string): string;

  // System Functions
  abstract recordId(): string;
  abstract autoNumber(): string;
  abstract textAll(value: string): string;

  // Binary Operations - Common implementations
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

  // Comparison Operations - Common implementations
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

  // Logical Operations - Common implementations
  logicalAnd(left: string, right: string): string {
    return `(${left} AND ${right})`;
  }

  logicalOr(left: string, right: string): string {
    return `(${left} OR ${right})`;
  }

  bitwiseAnd(left: string, right: string): string {
    return `(${left} & ${right})`;
  }

  // Unary Operations - Common implementations
  unaryMinus(value: string): string {
    return `(-${value})`;
  }

  // Field Reference - Common implementation
  abstract fieldReference(fieldId: string, columnName: string): string;

  // Literals - Common implementations
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

  // Utility methods - Common implementations
  castToNumber(value: string): string {
    return `CAST(${value} AS NUMERIC)`;
  }

  castToString(value: string): string {
    return `CAST(${value} AS TEXT)`;
  }

  castToBoolean(value: string): string {
    return `CAST(${value} AS BOOLEAN)`;
  }

  castToDate(value: string): string {
    return `CAST(${value} AS TIMESTAMP)`;
  }

  // Handle null values
  isNull(value: string): string {
    return `(${value} IS NULL)`;
  }

  coalesce(params: string[]): string {
    return `COALESCE(${params.join(', ')})`;
  }

  // Parentheses for grouping
  parentheses(expression: string): string {
    return `(${expression})`;
  }

  // Helper method to escape SQL identifiers
  protected escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  // Helper method to handle array parameters
  protected joinParams(params: string[], separator = ', '): string {
    return params.join(separator);
  }
}
