/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import { match } from 'ts-pattern';
import { FunctionName } from './functions/common';
import {
  BooleanLiteralContext,
  DecimalLiteralContext,
  IntegerLiteralContext,
  StringLiteralContext,
  FieldReferenceCurlyContext,
  BinaryOpContext,
  BracketsContext,
  FunctionCallContext,
  LeftWhitespaceOrCommentsContext,
  RightWhitespaceOrCommentsContext,
} from './parser/Formula';
import type { ExprContext, RootContext, UnaryOpContext } from './parser/Formula';
import type { FormulaVisitor } from './parser/FormulaVisitor';

/**
 * Interface for database-specific generated column query implementations
 * Used to convert Teable formula functions to database-specific SQL
 * expressions suitable for generated columns
 */
export interface IGeneratedColumnQueryInterface {
  // Context management
  setContext(context: IFormulaConversionContext): void;
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
  stringConcat(left: string, right: string): string;
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
  error(message: string): string;
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
  fieldReference(fieldId: string, columnName: string, context?: IFormulaConversionContext): string;

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
  fieldMap: {
    [fieldId: string]: {
      columnName: string;
      fieldType?: string;
      dbGenerated?: boolean;
      expandedExpression?: string;
    };
  };
  timeZone?: string;
}

/**
 * Result of formula conversion
 */
export interface IFormulaConversionResult {
  sql: string;
  dependencies: string[]; // field IDs that this formula depends on
}

/**
 * Visitor that converts Teable formula AST to SQL expressions
 * Uses dependency injection to get database-specific SQL implementations
 */
export class SqlConversionVisitor
  extends AbstractParseTreeVisitor<string>
  implements FormulaVisitor<string>
{
  protected defaultResult(): string {
    throw new Error('Method not implemented.');
  }
  private dependencies: string[] = [];

  constructor(
    private formulaQuery: IGeneratedColumnQueryInterface,
    private context: IFormulaConversionContext
  ) {
    super();
  }

  /**
   * Get the conversion result with SQL and dependencies
   */
  getResult(sql: string): IFormulaConversionResult {
    return {
      sql,
      dependencies: Array.from(new Set(this.dependencies)),
    };
  }

  visitRoot(ctx: RootContext): string {
    return ctx.expr().accept(this);
  }

  visitStringLiteral(ctx: StringLiteralContext): string {
    // Extract and return the string value without quotes
    const quotedString = ctx.text;
    const rawString = quotedString.slice(1, -1);
    // Handle escape characters
    const unescapedString = this.unescapeString(rawString);
    return this.formulaQuery.stringLiteral(unescapedString);
  }

  visitIntegerLiteral(ctx: IntegerLiteralContext): string {
    const value = parseInt(ctx.text, 10);
    return this.formulaQuery.numberLiteral(value);
  }

  visitDecimalLiteral(ctx: DecimalLiteralContext): string {
    const value = parseFloat(ctx.text);
    return this.formulaQuery.numberLiteral(value);
  }

  visitBooleanLiteral(ctx: BooleanLiteralContext): string {
    const value = ctx.text.toUpperCase() === 'TRUE';
    return this.formulaQuery.booleanLiteral(value);
  }

  visitLeftWhitespaceOrComments(ctx: LeftWhitespaceOrCommentsContext): string {
    return ctx.expr().accept(this);
  }

  visitRightWhitespaceOrComments(ctx: RightWhitespaceOrCommentsContext): string {
    return ctx.expr().accept(this);
  }

  visitBrackets(ctx: BracketsContext): string {
    const innerExpression = ctx.expr().accept(this);
    return this.formulaQuery.parentheses(innerExpression);
  }

  visitUnaryOp(ctx: UnaryOpContext): string {
    const operand = ctx.expr().accept(this);
    const operator = ctx.MINUS();

    if (operator) {
      return this.formulaQuery.unaryMinus(operand);
    }

    return operand;
  }

  visitBinaryOp(ctx: BinaryOpContext): string {
    const left = ctx.expr(0).accept(this);
    const right = ctx.expr(1).accept(this);
    const operator = ctx._op;

    return match(operator.text)
      .with('+', () => {
        // Check if either operand is a string type for concatenation
        const leftType = this.inferExpressionType(ctx.expr(0));
        const rightType = this.inferExpressionType(ctx.expr(1));

        if (leftType === 'string' || rightType === 'string') {
          return this.formulaQuery.stringConcat(left, right);
        }

        return this.formulaQuery.add(left, right);
      })
      .with('-', () => this.formulaQuery.subtract(left, right))
      .with('*', () => this.formulaQuery.multiply(left, right))
      .with('/', () => this.formulaQuery.divide(left, right))
      .with('%', () => this.formulaQuery.modulo(left, right))
      .with('>', () => this.formulaQuery.greaterThan(left, right))
      .with('<', () => this.formulaQuery.lessThan(left, right))
      .with('>=', () => this.formulaQuery.greaterThanOrEqual(left, right))
      .with('<=', () => this.formulaQuery.lessThanOrEqual(left, right))
      .with('=', () => this.formulaQuery.equal(left, right))
      .with('!=', '<>', () => this.formulaQuery.notEqual(left, right))
      .with('&&', () => this.formulaQuery.logicalAnd(left, right))
      .with('||', () => this.formulaQuery.logicalOr(left, right))
      .with('&', () => this.formulaQuery.bitwiseAnd(left, right))
      .otherwise((op) => {
        throw new Error(`Unsupported binary operator: ${op}`);
      });
  }

  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext): string {
    const fieldId = ctx.text.slice(1, -1); // Remove curly braces
    this.dependencies.push(fieldId);

    const fieldInfo = this.context.fieldMap[fieldId];
    if (!fieldInfo) {
      throw new Error(`Field not found: ${fieldId}`);
    }

    return this.formulaQuery.fieldReference(fieldId, fieldInfo.columnName, this.context);
  }

  visitFunctionCall(ctx: FunctionCallContext): string {
    const fnName = ctx.func_name().text.toUpperCase() as FunctionName;
    const params = ctx.expr().map((exprCtx) => exprCtx.accept(this));

    return (
      match(fnName)
        // Numeric Functions
        .with(FunctionName.Sum, () => this.formulaQuery.sum(params))
        .with(FunctionName.Average, () => this.formulaQuery.average(params))
        .with(FunctionName.Max, () => this.formulaQuery.max(params))
        .with(FunctionName.Min, () => this.formulaQuery.min(params))
        .with(FunctionName.Round, () => this.formulaQuery.round(params[0], params[1]))
        .with(FunctionName.RoundUp, () => this.formulaQuery.roundUp(params[0], params[1]))
        .with(FunctionName.RoundDown, () => this.formulaQuery.roundDown(params[0], params[1]))
        .with(FunctionName.Ceiling, () => this.formulaQuery.ceiling(params[0]))
        .with(FunctionName.Floor, () => this.formulaQuery.floor(params[0]))
        .with(FunctionName.Even, () => this.formulaQuery.even(params[0]))
        .with(FunctionName.Odd, () => this.formulaQuery.odd(params[0]))
        .with(FunctionName.Int, () => this.formulaQuery.int(params[0]))
        .with(FunctionName.Abs, () => this.formulaQuery.abs(params[0]))
        .with(FunctionName.Sqrt, () => this.formulaQuery.sqrt(params[0]))
        .with(FunctionName.Power, () => this.formulaQuery.power(params[0], params[1]))
        .with(FunctionName.Exp, () => this.formulaQuery.exp(params[0]))
        .with(FunctionName.Log, () => this.formulaQuery.log(params[0], params[1]))
        .with(FunctionName.Mod, () => this.formulaQuery.mod(params[0], params[1]))
        .with(FunctionName.Value, () => this.formulaQuery.value(params[0]))

        // Text Functions
        .with(FunctionName.Concatenate, () => this.formulaQuery.concatenate(params))
        .with(FunctionName.Find, () => this.formulaQuery.find(params[0], params[1], params[2]))
        .with(FunctionName.Search, () => this.formulaQuery.search(params[0], params[1], params[2]))
        .with(FunctionName.Mid, () => this.formulaQuery.mid(params[0], params[1], params[2]))
        .with(FunctionName.Left, () => this.formulaQuery.left(params[0], params[1]))
        .with(FunctionName.Right, () => this.formulaQuery.right(params[0], params[1]))
        .with(FunctionName.Replace, () =>
          this.formulaQuery.replace(params[0], params[1], params[2], params[3])
        )
        .with(FunctionName.RegExpReplace, () =>
          this.formulaQuery.regexpReplace(params[0], params[1], params[2])
        )
        .with(FunctionName.Substitute, () =>
          this.formulaQuery.substitute(params[0], params[1], params[2], params[3])
        )
        .with(FunctionName.Lower, () => this.formulaQuery.lower(params[0]))
        .with(FunctionName.Upper, () => this.formulaQuery.upper(params[0]))
        .with(FunctionName.Rept, () => this.formulaQuery.rept(params[0], params[1]))
        .with(FunctionName.Trim, () => this.formulaQuery.trim(params[0]))
        .with(FunctionName.Len, () => this.formulaQuery.len(params[0]))
        .with(FunctionName.T, () => this.formulaQuery.t(params[0]))
        .with(FunctionName.EncodeUrlComponent, () =>
          this.formulaQuery.encodeUrlComponent(params[0])
        )

        // DateTime Functions
        .with(FunctionName.Now, () => this.formulaQuery.now())
        .with(FunctionName.Today, () => this.formulaQuery.today())
        .with(FunctionName.DateAdd, () =>
          this.formulaQuery.dateAdd(params[0], params[1], params[2])
        )
        .with(FunctionName.Datestr, () => this.formulaQuery.datestr(params[0]))
        .with(FunctionName.DatetimeDiff, () =>
          this.formulaQuery.datetimeDiff(params[0], params[1], params[2])
        )
        .with(FunctionName.DatetimeFormat, () =>
          this.formulaQuery.datetimeFormat(params[0], params[1])
        )
        .with(FunctionName.DatetimeParse, () =>
          this.formulaQuery.datetimeParse(params[0], params[1])
        )
        .with(FunctionName.Day, () => this.formulaQuery.day(params[0]))
        .with(FunctionName.FromNow, () => this.formulaQuery.fromNow(params[0]))
        .with(FunctionName.Hour, () => this.formulaQuery.hour(params[0]))
        .with(FunctionName.IsAfter, () => this.formulaQuery.isAfter(params[0], params[1]))
        .with(FunctionName.IsBefore, () => this.formulaQuery.isBefore(params[0], params[1]))
        .with(FunctionName.IsSame, () => this.formulaQuery.isSame(params[0], params[1], params[2]))
        .with(FunctionName.LastModifiedTime, () => this.formulaQuery.lastModifiedTime())
        .with(FunctionName.Minute, () => this.formulaQuery.minute(params[0]))
        .with(FunctionName.Month, () => this.formulaQuery.month(params[0]))
        .with(FunctionName.Second, () => this.formulaQuery.second(params[0]))
        .with(FunctionName.Timestr, () => this.formulaQuery.timestr(params[0]))
        .with(FunctionName.ToNow, () => this.formulaQuery.toNow(params[0]))
        .with(FunctionName.WeekNum, () => this.formulaQuery.weekNum(params[0]))
        .with(FunctionName.Weekday, () => this.formulaQuery.weekday(params[0]))
        .with(FunctionName.Workday, () => this.formulaQuery.workday(params[0], params[1]))
        .with(FunctionName.WorkdayDiff, () => this.formulaQuery.workdayDiff(params[0], params[1]))
        .with(FunctionName.Year, () => this.formulaQuery.year(params[0]))
        .with(FunctionName.CreatedTime, () => this.formulaQuery.createdTime())

        // Logical Functions
        .with(FunctionName.If, () => this.formulaQuery.if(params[0], params[1], params[2]))
        .with(FunctionName.And, () => this.formulaQuery.and(params))
        .with(FunctionName.Or, () => this.formulaQuery.or(params))
        .with(FunctionName.Not, () => this.formulaQuery.not(params[0]))
        .with(FunctionName.Xor, () => this.formulaQuery.xor(params))
        .with(FunctionName.Blank, () => this.formulaQuery.blank())
        .with(FunctionName.IsError, () => this.formulaQuery.isError(params[0]))
        .with(FunctionName.Switch, () => {
          // Handle switch function with variable number of case-result pairs
          const expression = params[0];
          const cases: Array<{ case: string; result: string }> = [];
          let defaultResult: string | undefined;

          // Process pairs of case-result, with optional default at the end
          for (let i = 1; i < params.length; i += 2) {
            if (i + 1 < params.length) {
              cases.push({ case: params[i], result: params[i + 1] });
            } else {
              // Odd number of remaining params means we have a default value
              defaultResult = params[i];
            }
          }

          return this.formulaQuery.switch(expression, cases, defaultResult);
        })

        // Array Functions
        .with(FunctionName.Count, () => this.formulaQuery.count(params))
        .with(FunctionName.CountA, () => this.formulaQuery.countA(params))
        .with(FunctionName.CountAll, () => this.formulaQuery.countAll(params[0]))
        .with(FunctionName.ArrayJoin, () => this.formulaQuery.arrayJoin(params[0], params[1]))
        .with(FunctionName.ArrayUnique, () => this.formulaQuery.arrayUnique(params[0]))
        .with(FunctionName.ArrayFlatten, () => this.formulaQuery.arrayFlatten(params[0]))
        .with(FunctionName.ArrayCompact, () => this.formulaQuery.arrayCompact(params[0]))

        // System Functions
        .with(FunctionName.RecordId, () => this.formulaQuery.recordId())
        .with(FunctionName.AutoNumber, () => this.formulaQuery.autoNumber())
        .with(FunctionName.TextAll, () => this.formulaQuery.textAll(params[0]))

        .otherwise((fn) => {
          throw new Error(`Unsupported function: ${fn}`);
        })
    );
  }

  /**
   * Infer the type of an expression for type-aware operations
   */
  private inferExpressionType(ctx: ExprContext): 'string' | 'number' | 'boolean' | 'unknown' {
    // Handle literals
    const literalType = this.inferLiteralType(ctx);
    if (literalType !== 'unknown') {
      return literalType;
    }

    // Handle field references
    if (ctx instanceof FieldReferenceCurlyContext) {
      return this.inferFieldReferenceType(ctx);
    }

    // Handle function calls
    if (ctx instanceof FunctionCallContext) {
      return this.inferFunctionReturnType(ctx);
    }

    // Handle binary operations
    if (ctx instanceof BinaryOpContext) {
      return this.inferBinaryOperationType(ctx);
    }

    // Handle parentheses - infer from inner expression
    if (ctx instanceof BracketsContext) {
      return this.inferExpressionType(ctx.expr());
    }

    // Handle whitespace/comments - infer from inner expression
    if (
      ctx instanceof LeftWhitespaceOrCommentsContext ||
      ctx instanceof RightWhitespaceOrCommentsContext
    ) {
      return this.inferExpressionType(ctx.expr());
    }

    // Default to unknown for unhandled cases
    return 'unknown';
  }

  /**
   * Infer type from literal contexts
   */
  private inferLiteralType(ctx: ExprContext): 'string' | 'number' | 'boolean' | 'unknown' {
    if (ctx instanceof StringLiteralContext) {
      return 'string';
    }

    if (ctx instanceof IntegerLiteralContext || ctx instanceof DecimalLiteralContext) {
      return 'number';
    }

    if (ctx instanceof BooleanLiteralContext) {
      return 'boolean';
    }

    return 'unknown';
  }

  /**
   * Infer type from field reference
   */
  private inferFieldReferenceType(
    ctx: FieldReferenceCurlyContext
  ): 'string' | 'number' | 'boolean' | 'unknown' {
    const fieldId = ctx.text.slice(1, -1); // Remove curly braces
    const fieldInfo = this.context.fieldMap[fieldId];

    if (!fieldInfo?.fieldType) {
      return 'unknown';
    }

    return this.mapFieldTypeToBasicType(fieldInfo.fieldType);
  }

  /**
   * Map field types to basic types
   */
  private mapFieldTypeToBasicType(fieldType: string): 'string' | 'number' | 'boolean' | 'unknown' {
    const stringTypes = [
      'singleLineText',
      'longText',
      'singleSelect',
      'multipleSelect',
      'user',
      'createdBy',
      'lastModifiedBy',
      'attachment',
      'link',
      'date',
      'createdTime',
      'lastModifiedTime', // Dates are typically handled as strings in SQL
    ];

    const numberTypes = ['number', 'rating', 'autoNumber', 'count', 'rollup'];

    if (stringTypes.includes(fieldType)) {
      return 'string';
    }

    if (numberTypes.includes(fieldType)) {
      return 'number';
    }

    if (fieldType === 'checkbox') {
      return 'boolean';
    }

    if (fieldType === 'formula') {
      // For formula fields, we can't easily determine the type without recursion
      // Default to unknown to be safe
      return 'unknown';
    }

    return 'unknown';
  }

  /**
   * Infer return type from function calls
   */
  private inferFunctionReturnType(
    ctx: FunctionCallContext
  ): 'string' | 'number' | 'boolean' | 'unknown' {
    const fnName = ctx.func_name().text.toUpperCase();

    const stringFunctions = [
      'CONCATENATE',
      'LEFT',
      'RIGHT',
      'MID',
      'UPPER',
      'LOWER',
      'TRIM',
      'SUBSTITUTE',
      'REPLACE',
      'T',
      'DATESTR',
      'TIMESTR',
    ];

    const numberFunctions = [
      'SUM',
      'AVERAGE',
      'MAX',
      'MIN',
      'ROUND',
      'ROUNDUP',
      'ROUNDDOWN',
      'CEILING',
      'FLOOR',
      'ABS',
      'SQRT',
      'POWER',
      'EXP',
      'LOG',
      'MOD',
      'VALUE',
      'LEN',
      'COUNT',
      'COUNTA',
    ];

    const booleanFunctions = ['AND', 'OR', 'NOT', 'XOR'];

    if (stringFunctions.includes(fnName)) {
      return 'string';
    }

    if (numberFunctions.includes(fnName)) {
      return 'number';
    }

    if (booleanFunctions.includes(fnName)) {
      return 'boolean';
    }

    return 'unknown';
  }

  /**
   * Infer type from binary operations
   */
  private inferBinaryOperationType(
    ctx: BinaryOpContext
  ): 'string' | 'number' | 'boolean' | 'unknown' {
    const operator = ctx._op?.text;

    if (!operator) {
      return 'unknown';
    }

    const arithmeticOperators = ['+', '-', '*', '/', '%'];
    const comparisonOperators = ['>', '<', '>=', '<=', '=', '!=', '<>', '&&', '||'];

    if (arithmeticOperators.includes(operator)) {
      return 'number';
    }

    if (comparisonOperators.includes(operator)) {
      return 'boolean';
    }

    return 'unknown';
  }

  private unescapeString(str: string): string {
    return str.replace(/\\(.)/g, (_, char) => {
      return match(char)
        .with('n', () => '\n')
        .with('t', () => '\t')
        .with('r', () => '\r')
        .with('\\', () => '\\')
        .with("'", () => "'")
        .with('"', () => '"')
        .otherwise((c) => c);
    });
  }
}
