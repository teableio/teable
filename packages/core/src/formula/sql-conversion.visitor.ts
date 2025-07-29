/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import { FunctionName } from './functions/common';
import type {
  BinaryOpContext,
  BooleanLiteralContext,
  BracketsContext,
  DecimalLiteralContext,
  FunctionCallContext,
  IntegerLiteralContext,
  LeftWhitespaceOrCommentsContext,
  RightWhitespaceOrCommentsContext,
  RootContext,
  StringLiteralContext,
  FieldReferenceCurlyContext,
  UnaryOpContext,
} from './parser/Formula';
import type { FormulaVisitor } from './parser/FormulaVisitor';

/**
 * Interface for database-specific formula function implementations
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
    private formulaQuery: IFormulaQueryInterface,
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

    switch (operator.text) {
      case '+':
        return this.formulaQuery.add(left, right);
      case '-':
        return this.formulaQuery.subtract(left, right);
      case '*':
        return this.formulaQuery.multiply(left, right);
      case '/':
        return this.formulaQuery.divide(left, right);
      case '%':
        return this.formulaQuery.modulo(left, right);
      case '>':
        return this.formulaQuery.greaterThan(left, right);
      case '<':
        return this.formulaQuery.lessThan(left, right);
      case '>=':
        return this.formulaQuery.greaterThanOrEqual(left, right);
      case '<=':
        return this.formulaQuery.lessThanOrEqual(left, right);
      case '=':
        return this.formulaQuery.equal(left, right);
      case '!=':
      case '<>':
        return this.formulaQuery.notEqual(left, right);
      case '&&':
        return this.formulaQuery.logicalAnd(left, right);
      case '||':
        return this.formulaQuery.logicalOr(left, right);
      case '&':
        return this.formulaQuery.bitwiseAnd(left, right);
      default:
        throw new Error(`Unsupported binary operator: ${operator.text}`);
    }
  }

  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext): string {
    const fieldId = ctx.text.slice(1, -1); // Remove curly braces
    this.dependencies.push(fieldId);

    const fieldInfo = this.context.fieldMap[fieldId];
    if (!fieldInfo) {
      throw new Error(`Field not found: ${fieldId}`);
    }

    return this.formulaQuery.fieldReference(fieldId, fieldInfo.columnName);
  }

  visitFunctionCall(ctx: FunctionCallContext): string {
    const fnName = ctx.func_name().text.toUpperCase() as FunctionName;
    const params = ctx.expr().map((exprCtx) => exprCtx.accept(this));

    // eslint-disable-next-line sonarjs/max-switch-cases
    switch (fnName) {
      // Numeric Functions
      case FunctionName.Sum:
        return this.formulaQuery.sum(params);
      case FunctionName.Average:
        return this.formulaQuery.average(params);
      case FunctionName.Max:
        return this.formulaQuery.max(params);
      case FunctionName.Min:
        return this.formulaQuery.min(params);
      case FunctionName.Round:
        return this.formulaQuery.round(params[0], params[1]);
      case FunctionName.RoundUp:
        return this.formulaQuery.roundUp(params[0], params[1]);
      case FunctionName.RoundDown:
        return this.formulaQuery.roundDown(params[0], params[1]);
      case FunctionName.Ceiling:
        return this.formulaQuery.ceiling(params[0]);
      case FunctionName.Floor:
        return this.formulaQuery.floor(params[0]);
      case FunctionName.Even:
        return this.formulaQuery.even(params[0]);
      case FunctionName.Odd:
        return this.formulaQuery.odd(params[0]);
      case FunctionName.Int:
        return this.formulaQuery.int(params[0]);
      case FunctionName.Abs:
        return this.formulaQuery.abs(params[0]);
      case FunctionName.Sqrt:
        return this.formulaQuery.sqrt(params[0]);
      case FunctionName.Power:
        return this.formulaQuery.power(params[0], params[1]);
      case FunctionName.Exp:
        return this.formulaQuery.exp(params[0]);
      case FunctionName.Log:
        return this.formulaQuery.log(params[0], params[1]);
      case FunctionName.Mod:
        return this.formulaQuery.mod(params[0], params[1]);
      case FunctionName.Value:
        return this.formulaQuery.value(params[0]);

      // Text Functions
      case FunctionName.Concatenate:
        return this.formulaQuery.concatenate(params);
      case FunctionName.Find:
        return this.formulaQuery.find(params[0], params[1], params[2]);
      case FunctionName.Search:
        return this.formulaQuery.search(params[0], params[1], params[2]);
      case FunctionName.Mid:
        return this.formulaQuery.mid(params[0], params[1], params[2]);
      case FunctionName.Left:
        return this.formulaQuery.left(params[0], params[1]);
      case FunctionName.Right:
        return this.formulaQuery.right(params[0], params[1]);
      case FunctionName.Replace:
        return this.formulaQuery.replace(params[0], params[1], params[2], params[3]);
      case FunctionName.RegExpReplace:
        return this.formulaQuery.regexpReplace(params[0], params[1], params[2]);
      case FunctionName.Substitute:
        return this.formulaQuery.substitute(params[0], params[1], params[2], params[3]);
      case FunctionName.Lower:
        return this.formulaQuery.lower(params[0]);
      case FunctionName.Upper:
        return this.formulaQuery.upper(params[0]);
      case FunctionName.Rept:
        return this.formulaQuery.rept(params[0], params[1]);
      case FunctionName.Trim:
        return this.formulaQuery.trim(params[0]);
      case FunctionName.Len:
        return this.formulaQuery.len(params[0]);
      case FunctionName.T:
        return this.formulaQuery.t(params[0]);
      case FunctionName.EncodeUrlComponent:
        return this.formulaQuery.encodeUrlComponent(params[0]);

      // DateTime Functions
      case FunctionName.Now:
        return this.formulaQuery.now();
      case FunctionName.Today:
        return this.formulaQuery.today();
      case FunctionName.DateAdd:
        return this.formulaQuery.dateAdd(params[0], params[1], params[2]);
      case FunctionName.Datestr:
        return this.formulaQuery.datestr(params[0]);
      case FunctionName.DatetimeDiff:
        return this.formulaQuery.datetimeDiff(params[0], params[1], params[2]);
      case FunctionName.DatetimeFormat:
        return this.formulaQuery.datetimeFormat(params[0], params[1]);
      case FunctionName.DatetimeParse:
        return this.formulaQuery.datetimeParse(params[0], params[1]);
      case FunctionName.Day:
        return this.formulaQuery.day(params[0]);
      case FunctionName.FromNow:
        return this.formulaQuery.fromNow(params[0]);
      case FunctionName.Hour:
        return this.formulaQuery.hour(params[0]);
      case FunctionName.IsAfter:
        return this.formulaQuery.isAfter(params[0], params[1]);
      case FunctionName.IsBefore:
        return this.formulaQuery.isBefore(params[0], params[1]);
      case FunctionName.IsSame:
        return this.formulaQuery.isSame(params[0], params[1], params[2]);
      case FunctionName.LastModifiedTime:
        return this.formulaQuery.lastModifiedTime();
      case FunctionName.Minute:
        return this.formulaQuery.minute(params[0]);
      case FunctionName.Month:
        return this.formulaQuery.month(params[0]);
      case FunctionName.Second:
        return this.formulaQuery.second(params[0]);
      case FunctionName.Timestr:
        return this.formulaQuery.timestr(params[0]);
      case FunctionName.ToNow:
        return this.formulaQuery.toNow(params[0]);
      case FunctionName.WeekNum:
        return this.formulaQuery.weekNum(params[0]);
      case FunctionName.Weekday:
        return this.formulaQuery.weekday(params[0]);
      case FunctionName.Workday:
        return this.formulaQuery.workday(params[0], params[1]);
      case FunctionName.WorkdayDiff:
        return this.formulaQuery.workdayDiff(params[0], params[1]);
      case FunctionName.Year:
        return this.formulaQuery.year(params[0]);
      case FunctionName.CreatedTime:
        return this.formulaQuery.createdTime();

      // Logical Functions
      case FunctionName.If:
        return this.formulaQuery.if(params[0], params[1], params[2]);
      case FunctionName.And:
        return this.formulaQuery.and(params);
      case FunctionName.Or:
        return this.formulaQuery.or(params);
      case FunctionName.Not:
        return this.formulaQuery.not(params[0]);
      case FunctionName.Xor:
        return this.formulaQuery.xor(params);
      case FunctionName.Blank:
        return this.formulaQuery.blank();
      case FunctionName.IsError:
        return this.formulaQuery.isError(params[0]);
      case FunctionName.Switch: {
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
      }

      // Array Functions
      case FunctionName.Count:
        return this.formulaQuery.count(params);
      case FunctionName.CountA:
        return this.formulaQuery.countA(params);
      case FunctionName.CountAll:
        return this.formulaQuery.countAll(params[0]);
      case FunctionName.ArrayJoin:
        return this.formulaQuery.arrayJoin(params[0], params[1]);
      case FunctionName.ArrayUnique:
        return this.formulaQuery.arrayUnique(params[0]);
      case FunctionName.ArrayFlatten:
        return this.formulaQuery.arrayFlatten(params[0]);
      case FunctionName.ArrayCompact:
        return this.formulaQuery.arrayCompact(params[0]);

      // System Functions
      case FunctionName.RecordId:
        return this.formulaQuery.recordId();
      case FunctionName.AutoNumber:
        return this.formulaQuery.autoNumber();
      case FunctionName.TextAll:
        return this.formulaQuery.textAll(params[0]);

      default:
        throw new Error(`Unsupported function: ${fnName}`);
    }
  }

  private unescapeString(str: string): string {
    return str.replace(/\\(.)/g, (_, char) => {
      switch (char) {
        case 'n':
          return '\n';
        case 't':
          return '\t';
        case 'r':
          return '\r';
        case '\\':
          return '\\';
        case "'":
          return "'";
        case '"':
          return '"';
        default:
          return char;
      }
    });
  }
}
