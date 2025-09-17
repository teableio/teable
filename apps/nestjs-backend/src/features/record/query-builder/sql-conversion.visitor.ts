/* eslint-disable sonarjs/no-collapsible-if */
/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  StringLiteralContext,
  IntegerLiteralContext,
  LeftWhitespaceOrCommentsContext,
  RightWhitespaceOrCommentsContext,
  CircularReferenceError,
  FunctionCallContext,
  FunctionName,
  FieldType,
  DriverClient,
  AbstractParseTreeVisitor,
  BinaryOpContext,
  BooleanLiteralContext,
  BracketsContext,
  DecimalLiteralContext,
  FieldReferenceCurlyContext,
  isLinkField,
  parseFormula,
  isFieldHasExpression,
} from '@teable/core';
import type {
  FormulaVisitor,
  ExprContext,
  TableDomain,
  FieldCore,
  AutoNumberFieldCore,
  CreatedTimeFieldCore,
  LastModifiedTimeFieldCore,
  FormulaFieldCore,
  IFieldWithExpression,
} from '@teable/core';
import type { ITeableToDbFunctionConverter } from '@teable/core/src/formula/function-convertor.interface';
import type { RootContext, UnaryOpContext } from '@teable/core/src/formula/parser/Formula';
import type { Knex } from 'knex';
import { match } from 'ts-pattern';
import type { IFieldSelectName } from './field-select.type';
import { PgRecordQueryDialect } from './providers/pg-record-query-dialect';
import { SqliteRecordQueryDialect } from './providers/sqlite-record-query-dialect';
import type { IRecordSelectionMap } from './record-query-builder.interface';
import type { IRecordQueryDialectProvider } from './record-query-dialect.interface';

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
 * Context information for formula conversion
 */
export interface IFormulaConversionContext {
  table: TableDomain;
  /** Whether this conversion is for a generated column (affects immutable function handling) */
  isGeneratedColumn?: boolean;
  driverClient?: DriverClient;
  expansionCache?: Map<string, string>;
  /** Optional timezone to interpret date/time literals and fields in SELECT context */
  timeZone?: string;
}

/**
 * Extended context for select query formula conversion with CTE support
 */
export interface ISelectFormulaConversionContext extends IFormulaConversionContext {
  selectionMap: IRecordSelectionMap;
  /** Table alias to use for field references */
  tableAlias?: string;
  /** CTE map: linkFieldId -> cteName */
  fieldCteMap?: ReadonlyMap<string, string>;
}

/**
 * Result of formula conversion
 */
export interface IFormulaConversionResult {
  sql: string;
  dependencies: string[]; // field IDs that this formula depends on
}

/**
 * Interface for database-specific generated column query implementations
 * Each database provider (PostgreSQL, SQLite) should implement this interface
 * to provide SQL translations for Teable formula functions that will be used
 * in database generated columns. This interface ensures formula expressions
 * are converted to immutable SQL expressions suitable for generated columns.
 */
export interface IGeneratedColumnQueryInterface
  extends ITeableToDbFunctionConverter<string, IFormulaConversionContext> {}

/**
 * Interface for database-specific SELECT query implementations
 * Each database provider (PostgreSQL, SQLite) should implement this interface
 * to provide SQL translations for Teable formula functions that will be used
 * in SELECT statements as computed columns. Unlike generated columns, these
 * expressions can use mutable functions and have different optimization strategies.
 */
export interface ISelectQueryInterface
  extends ITeableToDbFunctionConverter<string, IFormulaConversionContext> {}

/**
 * Interface for validating whether Teable formula functions convert to generated column are supported
 * by a specific database provider. Each method returns a boolean indicating
 * whether the corresponding function can be converted to a valid database expression.
 */
export interface IGeneratedColumnQuerySupportValidator
  extends ITeableToDbFunctionConverter<boolean, IFormulaConversionContext> {}

/**
 * Get should expand field reference
 *
 * @param field
 * @returns boolean
 */
function shouldExpandFieldReference(
  field: FieldCore
): field is
  | FormulaFieldCore
  | AutoNumberFieldCore
  | CreatedTimeFieldCore
  | LastModifiedTimeFieldCore {
  return isFieldHasExpression(field);
}

/**
 * Abstract base visitor that contains common functionality for SQL conversion
 */
abstract class BaseSqlConversionVisitor<
    TFormulaQuery extends ITeableToDbFunctionConverter<string, IFormulaConversionContext>,
  >
  extends AbstractParseTreeVisitor<string>
  implements FormulaVisitor<IFieldSelectName>
{
  protected expansionStack: Set<string> = new Set();

  protected defaultResult(): string {
    throw new Error('Method not implemented.');
  }

  protected getQuestionMarkExpression(): string {
    if (this.context.driverClient === DriverClient.Sqlite) {
      return 'CHAR(63)';
    }
    return 'CHR(63)';
  }

  constructor(
    protected readonly knex: Knex,
    protected formulaQuery: TFormulaQuery,
    protected context: IFormulaConversionContext,
    protected dialect?: IRecordQueryDialectProvider
  ) {
    super();
    // Initialize a dialect provider for use in driver-specific pieces when callers don't inject one
    if (!this.dialect) {
      const d = this.context.driverClient;
      if (d === DriverClient.Pg) this.dialect = new PgRecordQueryDialect(this.knex);
      else this.dialect = new SqliteRecordQueryDialect(this.knex);
    }
  }

  visitRoot(ctx: RootContext): string {
    return ctx.expr().accept(this);
  }

  visitStringLiteral(ctx: StringLiteralContext): string {
    const quotedString = ctx.text;
    const rawString = quotedString.slice(1, -1);
    const unescapedString = unescapeString(rawString);

    if (!unescapedString.includes('?')) {
      return this.formulaQuery.stringLiteral(unescapedString);
    }

    const charExpr = this.getQuestionMarkExpression();
    const parts = unescapedString.split('?');
    const segments: string[] = [];

    parts.forEach((part, index) => {
      if (part.length) {
        segments.push(this.formulaQuery.stringLiteral(part));
      }
      if (index < parts.length - 1) {
        segments.push(charExpr);
      }
    });

    if (segments.length === 0) {
      return charExpr;
    }

    if (segments.length === 1) {
      return segments[0];
    }

    return this.formulaQuery.concatenate(segments);
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

    const fieldInfo = this.context.table.getField(fieldId);
    if (!fieldInfo) {
      throw new Error(`Field not found: ${fieldId}`);
    }

    // Check if this is a formula field that needs recursive expansion
    if (shouldExpandFieldReference(fieldInfo)) {
      return this.expandFormulaField(fieldId, fieldInfo);
    }

    // Note: user-related field handling for select queries is implemented
    // in SelectColumnSqlConversionVisitor where selection context exists.

    return this.formulaQuery.fieldReference(fieldId, fieldInfo.dbFieldName);
  }

  /**
   * Recursively expand a formula field reference
   * @param fieldId The field ID to expand
   * @param fieldInfo The field information
   * @returns The expanded SQL expression
   */
  protected expandFormulaField(fieldId: string, fieldInfo: IFieldWithExpression): string {
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

    // If no expression is found, fall back to normal field reference
    if (!expression) {
      return this.formulaQuery.fieldReference(fieldId, fieldInfo.dbFieldName);
    }

    // Add to expansion stack to detect circular references
    this.expansionStack.add(fieldId);

    try {
      // Recursively expand the expression by parsing and visiting it
      const tree = parseFormula(expression);
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
    let left = ctx.expr(0).accept(this);
    let right = ctx.expr(1).accept(this);
    const operator = ctx._op;

    // For comparison operators, ensure operands are comparable to avoid
    // Postgres errors like "operator does not exist: text > integer".
    // If one side is number and the other is string, safely cast the string
    // side to numeric (driver-aware) before building the comparison.
    const leftType = this.inferExpressionType(ctx.expr(0));
    const rightType = this.inferExpressionType(ctx.expr(1));
    const needsNumericCoercion = (op: string) =>
      ['>', '<', '>=', '<=', '=', '!=', '<>'].includes(op);
    if (operator.text && needsNumericCoercion(operator.text)) {
      if (leftType === 'number' && rightType === 'string') {
        right = this.safeCastToNumeric(right);
      } else if (leftType === 'string' && rightType === 'number') {
        left = this.safeCastToNumeric(left);
      }
    }

    // For arithmetic operators (except '+'), coerce string operands to numeric
    // so expressions like "text * 3" or "'10' / '2'" work without errors in generated columns.
    const needsArithmeticNumericCoercion = (op: string) => ['*', '/', '-', '%'].includes(op);
    if (operator.text && needsArithmeticNumericCoercion(operator.text)) {
      if (leftType === 'string') {
        left = this.safeCastToNumeric(left);
      }
      if (rightType === 'string') {
        right = this.safeCastToNumeric(right);
      }
    }

    return match(operator.text)
      .with('+', () => {
        // Check if either operand is a string type for concatenation
        const _leftType = this.inferExpressionType(ctx.expr(0));
        const _rightType = this.inferExpressionType(ctx.expr(1));

        if (_leftType === 'string' || _rightType === 'string') {
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
      .with('&', () => {
        // Always treat & as string concatenation to avoid type issues
        return this.formulaQuery.stringConcat(left, right);
      })
      .otherwise((op) => {
        throw new Error(`Unsupported binary operator: ${op}`);
      });
  }

  /**
   * Safely cast an expression to numeric for comparisons.
   * For PostgreSQL, avoid runtime errors by returning NULL for non-numeric text.
   * For other drivers, fall back to a direct numeric cast.
   */
  private safeCastToNumeric(value: string): string {
    return this.dialect!.coerceToNumericForCompare(value);
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
    const fieldInfo = this.context.table.getField(fieldId);

    if (!fieldInfo?.type) {
      return 'unknown';
    }

    // For formula fields, try to infer the actual return type from cellValueType
    if (fieldInfo.type === 'formula' && fieldInfo.cellValueType) {
      return this.mapCellValueTypeToBasicType(fieldInfo.cellValueType);
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
   * Map cell value types to basic types
   */
  private mapCellValueTypeToBasicType(
    cellValueType: string
  ): 'string' | 'number' | 'boolean' | 'unknown' {
    switch (cellValueType) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      default:
        return 'unknown';
    }
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

    const arithmeticOperators = ['-', '*', '/', '%'];
    const comparisonOperators = ['>', '<', '>=', '<=', '=', '!=', '<>', '&&', '||'];
    const stringOperators = ['&']; // Bitwise AND is treated as string concatenation

    // Special handling for + operator - it can be either arithmetic or string concatenation
    if (operator === '+') {
      const leftType = this.inferExpressionType(ctx.expr(0));
      const rightType = this.inferExpressionType(ctx.expr(1));

      if (leftType === 'string' || rightType === 'string') {
        return 'string';
      }

      return 'number';
    }

    if (arithmeticOperators.includes(operator)) {
      return 'number';
    }

    if (comparisonOperators.includes(operator)) {
      return 'boolean';
    }

    if (stringOperators.includes(operator)) {
      return 'string';
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
  /**
   * Override field reference handling to support CTE-based field references
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext): string {
    const fieldId = ctx.text.slice(1, -1); // Remove curly braces

    const fieldInfo = this.context.table.getField(fieldId);
    if (!fieldInfo) {
      // Fallback: referenced field not found in current table domain.
      // Return NULL and emit a warning for visibility without breaking the query.
      try {
        const t = this.context.table;
        // eslint-disable-next-line no-console
        console.warn(
          `Select formula fallback: missing field {${fieldId}} in table ${t?.name || ''}(${t?.id || ''}); selecting NULL`
        );
      } catch {
        // ignore logging failures
      }
      return 'NULL';
    }

    // Check if this field has a CTE mapping (for link, lookup, rollup fields)
    const selectContext = this.context as ISelectFormulaConversionContext;
    const selectionMap = selectContext.selectionMap;
    const selection = selectionMap?.get(fieldId);
    let selectionSql = typeof selection === 'string' ? selection : selection?.toSQL().sql;
    const cteMap = selectContext.fieldCteMap;
    // For link fields with CTE mapping, use the CTE directly
    // No need for complex cross-CTE reference handling in most cases

    // Handle different field types that use CTEs
    if (isLinkField(fieldInfo)) {
      // Prefer CTE map resolution when available
      if (cteMap?.has(fieldId)) {
        const cteName = cteMap.get(fieldId)!;
        selectionSql = `"${cteName}"."link_value"`;
      }
      // Provide a safe fallback if selection map has no entry
      if (!selectionSql) {
        if (selectContext.tableAlias) {
          selectionSql = `"${selectContext.tableAlias}"."${fieldInfo.dbFieldName}"`;
        } else {
          selectionSql = `"${fieldInfo.dbFieldName}"`;
        }
      }
      // Check if this link field is being used in a boolean context
      const isBooleanContext = this.isInBooleanContext(ctx);

      // Use database driver from context
      if (isBooleanContext) {
        return this.dialect!.linkHasAny(selectionSql);
      }
      // For non-boolean context, extract title values as JSON array or single title
      return this.dialect!.linkExtractTitles(selectionSql, !!fieldInfo.isMultipleCellValue);
    }

    // Check if this is a formula field that needs recursive expansion
    if (shouldExpandFieldReference(fieldInfo)) {
      return this.expandFormulaField(fieldId, fieldInfo);
    }

    // If this is a lookup or rollup and CTE map is available, use it
    if (
      cteMap &&
      fieldInfo.lookupOptions?.linkFieldId &&
      cteMap.has(fieldInfo.lookupOptions.linkFieldId)
    ) {
      const cteName = cteMap.get(fieldInfo.lookupOptions.linkFieldId)!;
      const columnName = fieldInfo.isLookup
        ? `lookup_${fieldInfo.id}`
        : (fieldInfo as unknown as { type?: string }).type === 'rollup'
          ? `rollup_${fieldInfo.id}`
          : undefined;
      if (columnName) {
        return `"${cteName}"."${columnName}"`;
      }
    }

    // Handle user-related fields
    if (fieldInfo.type === FieldType.CreatedBy || fieldInfo.type === FieldType.LastModifiedBy) {
      // For system user fields, derive directly from system columns to avoid JSON dependency
      const alias = selectContext.tableAlias;
      const sysCol = fieldInfo.type === FieldType.CreatedBy ? '__created_by' : '__last_modified_by';
      const idRef = alias ? `"${alias}"."${sysCol}"` : `"${sysCol}"`;
      return this.dialect!.selectUserNameById(idRef);
    }
    if (fieldInfo.type === FieldType.User) {
      // For normal User fields, extract title from the JSON selection when available
      if (!selectionSql) {
        if (selectContext.tableAlias) {
          selectionSql = `"${selectContext.tableAlias}"."${fieldInfo.dbFieldName}"`;
        } else {
          selectionSql = `"${fieldInfo.dbFieldName}"`;
        }
      }
      return this.dialect!.jsonTitleFromExpr(selectionSql);
    }

    if (selectionSql) {
      return selectionSql;
    }
    // Use table alias if provided in context
    if (selectContext.tableAlias) {
      return `"${selectContext.tableAlias}"."${fieldInfo.dbFieldName}"`;
    }

    return this.formulaQuery.fieldReference(fieldId, fieldInfo.dbFieldName);
  }

  /**
   * Check if a field reference is being used in a boolean context
   * (i.e., as a parameter to logical functions like AND, OR, NOT, etc.)
   */
  private isInBooleanContext(ctx: FieldReferenceCurlyContext): boolean {
    let parent = ctx.parent;

    // Walk up the parse tree to find if we're inside a logical function
    while (parent) {
      if (parent instanceof FunctionCallContext) {
        const fnName = parent.func_name().text.toUpperCase();
        const booleanFunctions = ['AND', 'OR', 'NOT', 'XOR', 'IF'];
        return booleanFunctions.includes(fnName);
      }

      // Also check for binary logical operators
      if (parent instanceof BinaryOpContext) {
        const operator = parent._op?.text;
        const logicalOperators = ['&&', '||', '=', '!=', '<>', '>', '<', '>=', '<='];
        return logicalOperators.includes(operator || '');
      }

      parent = parent.parent;
    }

    return false;
  }
}
