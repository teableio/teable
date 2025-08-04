/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import { match } from 'ts-pattern';
import { FormulaFieldCore } from '../models/field/derivate/formula.field';
import { isGeneratedFormulaField } from '../models/field/field.util';
import { CircularReferenceError } from './errors/circular-reference.error';
import type {
  IFormulaConversionContext,
  IFormulaConversionResult,
  IGeneratedColumnQueryInterface,
  ISelectQueryInterface,
  ITeableToDbFunctionConverter,
} from './function-convertor.interface';
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

function unescapeString(str: string): string {
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

/**
 * Abstract base visitor that contains common functionality for SQL conversion
 */
abstract class BaseSqlConversionVisitor<
    TFormulaQuery extends ITeableToDbFunctionConverter<string, IFormulaConversionContext>,
  >
  extends AbstractParseTreeVisitor<string>
  implements FormulaVisitor<string>
{
  protected expansionStack: Set<string> = new Set();

  protected defaultResult(): string {
    throw new Error('Method not implemented.');
  }

  constructor(
    protected formulaQuery: TFormulaQuery,
    protected context: IFormulaConversionContext
  ) {
    super();
  }

  visitRoot(ctx: RootContext): string {
    return ctx.expr().accept(this);
  }

  visitStringLiteral(ctx: StringLiteralContext): string {
    // Extract and return the string value without quotes
    const quotedString = ctx.text;
    const rawString = quotedString.slice(1, -1);
    // Handle escape characters
    const unescapedString = unescapeString(rawString);
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

  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext): string {
    const fieldId = ctx.text.slice(1, -1); // Remove curly braces

    const fieldInfo = this.context.fieldMap.get(fieldId);
    if (!fieldInfo) {
      throw new Error(`Field not found: ${fieldId}`);
    }

    // Check if this is a formula field that needs recursive expansion
    if (isGeneratedFormulaField(fieldInfo)) {
      return this.expandFormulaField(fieldId, fieldInfo);
    }

    return this.formulaQuery.fieldReference(fieldId, fieldInfo.dbFieldName, this.context);
  }

  /**
   * Recursively expand a formula field reference
   * @param fieldId The field ID to expand
   * @param fieldInfo The field information
   * @returns The expanded SQL expression
   */
  protected expandFormulaField(fieldId: string, fieldInfo: FormulaFieldCore): string {
    // Initialize expansion cache if not present
    if (!this.context.expansionCache) {
      this.context.expansionCache = new Map();
    }

    // Check cache first
    if (this.context.expansionCache.has(fieldId)) {
      return this.context.expansionCache.get(fieldId)!;
    }

    // Check for circular references
    if (this.expansionStack.has(fieldId)) {
      throw new CircularReferenceError(fieldId, Array.from(this.expansionStack));
    }

    const expression = fieldInfo.getExpression();

    if (!expression) {
      throw new Error(`No expression found for formula field ${fieldId}`);
    }

    // Add to expansion stack to detect circular references
    this.expansionStack.add(fieldId);

    try {
      // Recursively expand the expression by parsing and visiting it
      const tree = FormulaFieldCore.parse(expression);
      const expandedSql = tree.accept(this);

      // Cache the result
      this.context.expansionCache.set(fieldId, expandedSql);

      return expandedSql;
    } finally {
      // Remove from expansion stack
      this.expansionStack.delete(fieldId);
    }
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
    const fieldInfo = this.context.fieldMap.get(fieldId);

    if (!fieldInfo?.type) {
      return 'unknown';
    }

    return this.mapFieldTypeToBasicType(fieldInfo.type);
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
}

/**
 * Visitor that converts Teable formula AST to SQL expressions for generated columns
 * Uses dependency injection to get database-specific SQL implementations
 * Tracks field dependencies for generated column updates
 */
export class GeneratedColumnSqlConversionVisitor extends BaseSqlConversionVisitor<IGeneratedColumnQueryInterface> {
  private dependencies: string[] = [];

  constructor(formulaQuery: IGeneratedColumnQueryInterface, context: IFormulaConversionContext) {
    super(formulaQuery, context);
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

  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext): string {
    const fieldId = ctx.text.slice(1, -1); // Remove curly braces
    this.dependencies.push(fieldId);
    return super.visitFieldReferenceCurly(ctx);
  }
}

/**
 * Visitor that converts Teable formula AST to SQL expressions for select queries
 * Uses dependency injection to get database-specific SQL implementations
 * Does not track dependencies as it's used for runtime queries
 */
export class SelectColumnSqlConversionVisitor extends BaseSqlConversionVisitor<ISelectQueryInterface> {
  constructor(formulaQuery: ISelectQueryInterface, context: IFormulaConversionContext) {
    super(formulaQuery, context);
  }
}
