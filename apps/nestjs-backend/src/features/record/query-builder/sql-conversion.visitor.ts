/* eslint-disable regexp/no-unused-capturing-group */
/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable regexp/no-dupe-characters-character-class */
/* eslint-disable sonarjs/no-duplicated-branches */
/* eslint-disable @typescript-eslint/naming-convention */
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
  CellValueType,
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
  isFormulaField,
  isLinkLookupOptions,
  normalizeFunctionNameAlias,
  DbFieldType,
  DateFormattingPreset,
  extractFieldReferenceId,
  getFieldReferenceTokenText,
  FUNCTIONS,
  Relationship,
  TimeFormatting,
} from '@teable/core';
import type {
  FormulaVisitor,
  ExprContext,
  TableDomain,
  FieldCore,
  AutoNumberFieldCore,
  CreatedTimeFieldCore,
  LastModifiedByFieldCore,
  LastModifiedTimeFieldCore,
  FormulaFieldCore,
  IFieldWithExpression,
  IFormulaParamMetadata,
  IFormulaParamFieldMetadata,
  FormulaParamType,
  IDatetimeFormatting,
  ITeableToDbFunctionConverter,
} from '@teable/core';
import type { RootContext, UnaryOpContext } from '@teable/formula';
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

const STRING_FUNCTIONS = new Set<FunctionName>([
  FunctionName.Concatenate,
  FunctionName.Left,
  FunctionName.Right,
  FunctionName.Mid,
  FunctionName.Upper,
  FunctionName.Lower,
  FunctionName.Trim,
  FunctionName.Substitute,
  FunctionName.Replace,
  FunctionName.T,
  FunctionName.Blank,
  FunctionName.Datestr,
  FunctionName.Timestr,
  FunctionName.ArrayJoin,
]);

const NUMBER_FUNCTIONS = new Set<FunctionName>([
  FunctionName.Sum,
  FunctionName.Average,
  FunctionName.Max,
  FunctionName.Min,
  FunctionName.Round,
  FunctionName.RoundUp,
  FunctionName.RoundDown,
  FunctionName.Ceiling,
  FunctionName.Floor,
  FunctionName.Abs,
  FunctionName.Sqrt,
  FunctionName.Power,
  FunctionName.Exp,
  FunctionName.Log,
  FunctionName.Mod,
  FunctionName.Value,
  FunctionName.Find,
  FunctionName.Search,
  FunctionName.Len,
  FunctionName.Count,
  FunctionName.CountA,
  FunctionName.CountAll,
]);

const BOOLEAN_FUNCTIONS = new Set<FunctionName>([
  FunctionName.And,
  FunctionName.Or,
  FunctionName.Not,
  FunctionName.Xor,
]);

const MULTI_VALUE_AGGREGATED_FUNCTIONS = new Set<FunctionName>([
  FunctionName.DatetimeFormat,
  FunctionName.Value,
  FunctionName.Abs,
  FunctionName.Datestr,
  FunctionName.Timestr,
  FunctionName.Day,
  FunctionName.Month,
  FunctionName.Year,
  FunctionName.Weekday,
  FunctionName.WeekNum,
  FunctionName.Hour,
  FunctionName.Minute,
  FunctionName.Second,
  FunctionName.FromNow,
  FunctionName.ToNow,
  FunctionName.Round,
  FunctionName.RoundUp,
  FunctionName.RoundDown,
  FunctionName.Floor,
  FunctionName.Ceiling,
  FunctionName.Int,
]);

const MULTI_VALUE_FIELD_TYPES = new Set<FieldType>([
  FieldType.Link,
  FieldType.Attachment,
  FieldType.MultipleSelect,
  FieldType.User,
  FieldType.CreatedBy,
  FieldType.LastModifiedBy,
]);

const STRING_FIELD_TYPES = new Set<FieldType>([
  FieldType.SingleLineText,
  FieldType.LongText,
  FieldType.SingleSelect,
  FieldType.MultipleSelect,
  FieldType.User,
  FieldType.CreatedBy,
  FieldType.LastModifiedBy,
  FieldType.Attachment,
  FieldType.Link,
  FieldType.Button,
]);

const DATETIME_FIELD_TYPES = new Set<FieldType>([
  FieldType.Date,
  FieldType.CreatedTime,
  FieldType.LastModifiedTime,
]);

const NUMBER_FIELD_TYPES = new Set<FieldType>([
  FieldType.Number,
  FieldType.Rating,
  FieldType.AutoNumber,
  FieldType.Rollup,
]);

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
  /** Link field IDs whose CTEs have already been emitted (safe for reference) */
  readyLinkFieldIds?: ReadonlySet<string>;
  /** Current link field id whose CTE is being generated (used to avoid self references) */
  currentLinkFieldId?: string;
  /** When true, prefer raw field references (no title formatting) to preserve native types */
  preferRawFieldReferences?: boolean;
  /** Target DB field type for the enclosing formula selection (used for type-sensitive raw projection) */
  targetDbFieldType?: DbFieldType;
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
  if (isFormulaField(field) && field.isLookup) {
    return false;
  }
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
    const operandCtx = ctx.expr();
    const operand = operandCtx.accept(this);
    const operator = ctx.MINUS();
    const metadata = [this.buildParamMetadata(operandCtx)];
    this.formulaQuery.setCallMetadata(metadata);

    try {
      if (operator) {
        return this.formulaQuery.unaryMinus(operand);
      }
      return operand;
    } finally {
      this.formulaQuery.setCallMetadata(undefined);
    }
  }

  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext): string {
    const normalizedFieldId = extractFieldReferenceId(ctx);
    const rawToken = getFieldReferenceTokenText(ctx);
    const fieldId = normalizedFieldId ?? rawToken?.slice(1, -1)?.trim() ?? '';

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

    const selectContext = this.context as ISelectFormulaConversionContext | undefined;
    const prevTargetDbFieldType = selectContext?.targetDbFieldType;
    const prevTimeZone = selectContext?.timeZone;
    const nextTargetDbFieldType = (fieldInfo as unknown as { dbFieldType?: DbFieldType })
      ?.dbFieldType;
    const rawOptions = (fieldInfo as unknown as { options?: unknown })?.options;
    let nextTimeZone: string | undefined;
    if (rawOptions && typeof rawOptions === 'object') {
      nextTimeZone = (rawOptions as { timeZone?: string }).timeZone;
    } else if (typeof rawOptions === 'string') {
      try {
        nextTimeZone = (JSON.parse(rawOptions) as { timeZone?: string } | undefined)?.timeZone;
      } catch {
        nextTimeZone = undefined;
      }
    }

    if (selectContext) {
      if (nextTargetDbFieldType != null) {
        selectContext.targetDbFieldType = nextTargetDbFieldType;
      }
      if (nextTimeZone != null) {
        selectContext.timeZone = nextTimeZone;
      }
    }

    try {
      // Recursively expand the expression by parsing and visiting it
      const tree = parseFormula(expression);
      const expandedSql = tree.accept(this);

      // Cache the result
      this.context.expansionCache.set(fieldId, expandedSql);

      return expandedSql;
    } finally {
      if (selectContext) {
        selectContext.targetDbFieldType = prevTargetDbFieldType;
        selectContext.timeZone = prevTimeZone;
      }
      // Remove from expansion stack
      this.expansionStack.delete(fieldId);
    }
  }

  visitFunctionCall(ctx: FunctionCallContext): string {
    const rawName = ctx.func_name().text.toUpperCase();
    const fnName = normalizeFunctionNameAlias(rawName) as FunctionName;
    const exprContexts = ctx.expr();
    let params = exprContexts.map((exprCtx) => exprCtx.accept(this));
    params = this.normalizeFunctionParamsForMultiplicity(fnName, params, exprContexts);
    const paramMetadata = exprContexts.map((exprCtx) => this.buildParamMetadata(exprCtx));
    this.formulaQuery.setCallMetadata(paramMetadata);

    const execute = () => {
      const multiValueFormat = this.tryBuildMultiValueAggregator(fnName, params, exprContexts);
      if (multiValueFormat) {
        return multiValueFormat;
      }

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
          .with(FunctionName.Concatenate, () => {
            const coerced = params.map((param, index) =>
              this.coerceToStringForConcatenation(param, exprContexts[index])
            );
            return this.formulaQuery.concatenate(coerced);
          })
          .with(FunctionName.Find, () => this.formulaQuery.find(params[0], params[1], params[2]))
          .with(FunctionName.Search, () =>
            this.formulaQuery.search(params[0], params[1], params[2])
          )
          .with(FunctionName.Mid, () => this.formulaQuery.mid(params[0], params[1], params[2]))
          .with(FunctionName.Left, () => {
            const textOperand = this.coerceToStringForConcatenation(params[0], exprContexts[0]);
            const sliceLength = this.normalizeTextSliceCount(params[1], exprContexts[1]);
            return this.formulaQuery.left(textOperand, sliceLength);
          })
          .with(FunctionName.Right, () => {
            const textOperand = this.coerceToStringForConcatenation(params[0], exprContexts[0]);
            const sliceLength = this.normalizeTextSliceCount(params[1], exprContexts[1]);
            return this.formulaQuery.right(textOperand, sliceLength);
          })
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
          .with(FunctionName.DatetimeDiff, () => {
            const unitExpr = params[2] ?? `'day'`;
            return this.formulaQuery.datetimeDiff(params[0], params[1], unitExpr);
          })
          .with(FunctionName.DatetimeFormat, () =>
            this.formulaQuery.datetimeFormat(params[0], params[1])
          )
          .with(FunctionName.DatetimeParse, () =>
            this.formulaQuery.datetimeParse(params[0], params[1])
          )
          .with(FunctionName.Day, () => this.formulaQuery.day(params[0]))
          .with(FunctionName.FromNow, () => this.formulaQuery.fromNow(params[0], params[1]))
          .with(FunctionName.Hour, () => this.formulaQuery.hour(params[0]))
          .with(FunctionName.IsAfter, () => this.formulaQuery.isAfter(params[0], params[1]))
          .with(FunctionName.IsBefore, () => this.formulaQuery.isBefore(params[0], params[1]))
          .with(FunctionName.IsSame, () =>
            this.formulaQuery.isSame(params[0], params[1], params[2])
          )
          .with(FunctionName.LastModifiedTime, () => this.formulaQuery.lastModifiedTime())
          .with(FunctionName.Minute, () => this.formulaQuery.minute(params[0]))
          .with(FunctionName.Month, () => this.formulaQuery.month(params[0]))
          .with(FunctionName.Second, () => this.formulaQuery.second(params[0]))
          .with(FunctionName.Timestr, () => this.formulaQuery.timestr(params[0]))
          .with(FunctionName.ToNow, () => this.formulaQuery.toNow(params[0], params[1]))
          .with(FunctionName.WeekNum, () => this.formulaQuery.weekNum(params[0]))
          .with(FunctionName.Weekday, () => this.formulaQuery.weekday(params[0], params[1]))
          .with(FunctionName.Workday, () => this.formulaQuery.workday(params[0], params[1]))
          .with(FunctionName.WorkdayDiff, () => this.formulaQuery.workdayDiff(params[0], params[1]))
          .with(FunctionName.Year, () => this.formulaQuery.year(params[0]))
          .with(FunctionName.CreatedTime, () => this.formulaQuery.createdTime())

          // Logical Functions
          .with(FunctionName.If, () => {
            const [rawConditionSql, rawTrueSql, rawFalseSql] = params;
            const conditionSql = rawConditionSql ?? 'NULL';
            const trueSql = rawTrueSql ?? 'NULL';
            const falseSql = rawFalseSql ?? 'NULL';

            let coercedTrue = trueSql;
            let coercedFalse = falseSql;

            const trueExprCtx = exprContexts[1];
            const falseExprCtx = exprContexts[2];
            const trueType = this.inferExpressionType(trueExprCtx);
            const falseType = this.inferExpressionType(falseExprCtx);
            const trueSqlTrimmed = (rawTrueSql ?? '').trim();
            const falseSqlTrimmed = (rawFalseSql ?? '').trim();
            const trueIsBlank =
              rawTrueSql == null ||
              this.isBlankLikeExpression(trueExprCtx) ||
              trueSqlTrimmed === "''";
            const falseIsBlank =
              rawFalseSql == null ||
              this.isBlankLikeExpression(falseExprCtx) ||
              falseSqlTrimmed === "''";

            const shouldNullOutTrueBranch = trueIsBlank && falseType !== 'string';
            const shouldNullOutFalseBranch = falseIsBlank && trueType !== 'string';

            if (shouldNullOutTrueBranch) {
              coercedTrue = 'NULL';
            }

            if (shouldNullOutFalseBranch) {
              coercedFalse = 'NULL';
            }

            if (this.inferExpressionType(ctx) === 'string') {
              coercedTrue = this.coerceCaseBranchToText(coercedTrue);
              coercedFalse = this.coerceCaseBranchToText(coercedFalse);
            }

            return this.formulaQuery.if(conditionSql, coercedTrue, coercedFalse);
          })
          .with(FunctionName.And, () => {
            const booleanParams = params.map((param, index) =>
              this.normalizeBooleanExpression(param, exprContexts[index])
            );
            return this.formulaQuery.and(booleanParams);
          })
          .with(FunctionName.Or, () => {
            const booleanParams = params.map((param, index) =>
              this.normalizeBooleanExpression(param, exprContexts[index])
            );
            return this.formulaQuery.or(booleanParams);
          })
          .with(FunctionName.Not, () => {
            const booleanParam = this.normalizeBooleanExpression(params[0], exprContexts[0]);
            return this.formulaQuery.not(booleanParam);
          })
          .with(FunctionName.Xor, () => {
            const booleanParams = params.map((param, index) =>
              this.normalizeBooleanExpression(param, exprContexts[index])
            );
            return this.formulaQuery.xor(booleanParams);
          })
          .with(FunctionName.Blank, () => this.formulaQuery.blank())
          .with(FunctionName.IsError, () => this.formulaQuery.isError(params[0]))
          .with(FunctionName.Switch, () => {
            // Handle switch function with variable number of case-result pairs
            const expression = params[0];
            const cases: Array<{ case: string; result: string }> = [];
            let defaultResult: string | undefined;

            type SwitchResultEntry = {
              sql: string;
              ctx: ExprContext;
              type: 'string' | 'number' | 'boolean' | 'datetime' | 'unknown';
            };

            const resultEntries: SwitchResultEntry[] = [];

            // Helper to normalize blank-like results when other branches require stricter typing
            const normalizeBlankResults = () => {
              const hasNumber = resultEntries.some((entry) => entry.type === 'number');
              const hasBoolean = resultEntries.some((entry) => entry.type === 'boolean');
              const hasDatetime = resultEntries.some((entry) => entry.type === 'datetime');

              const requiresNumeric = hasNumber;
              const requiresBoolean = hasBoolean;
              const requiresDatetime = hasDatetime;

              const shouldNullifyEntry = (entry: SwitchResultEntry): boolean => {
                const isBlank =
                  this.isBlankLikeExpression(entry.ctx) || (entry.sql ?? '').trim() === "''";

                if (!isBlank) {
                  return false;
                }

                if (requiresNumeric && entry.type !== 'number') {
                  return true;
                }

                if (requiresBoolean && entry.type !== 'boolean') {
                  return true;
                }

                if (requiresDatetime && entry.type !== 'datetime') {
                  return true;
                }

                return false;
              };

              for (const entry of resultEntries) {
                if (shouldNullifyEntry(entry)) {
                  entry.sql = 'NULL';
                }
              }
            };

            // Collect case/result pairs and default (if any)
            for (let i = 1; i < params.length; i += 2) {
              if (i + 1 < params.length) {
                const resultCtx = exprContexts[i + 1];
                resultEntries.push({
                  sql: params[i + 1],
                  ctx: resultCtx,
                  type: this.inferExpressionType(resultCtx),
                });

                cases.push({
                  case: params[i],
                  result: params[i + 1],
                });
              } else {
                const resultCtx = exprContexts[i];
                resultEntries.push({
                  sql: params[i],
                  ctx: resultCtx,
                  type: this.inferExpressionType(resultCtx),
                });
                defaultResult = params[i];
              }
            }

            // Normalize blank results only after we have collected all branch types
            normalizeBlankResults();

            if (this.inferExpressionType(ctx) === 'string') {
              for (const entry of resultEntries) {
                entry.sql = this.coerceCaseBranchToText(entry.sql);
              }
            }

            // Apply normalized SQL back to cases/default
            let resultIndex = 0;
            for (let i = 0; i < cases.length; i++) {
              cases[i] = {
                case: cases[i].case,
                result: resultEntries[resultIndex++].sql,
              };
            }

            if (defaultResult !== undefined) {
              defaultResult = resultEntries[resultIndex]?.sql;
            }

            return this.formulaQuery.switch(expression, cases, defaultResult);
          })

          // Array Functions
          .with(FunctionName.Count, () => this.formulaQuery.count(params))
          .with(FunctionName.CountA, () => this.formulaQuery.countA(params))
          .with(FunctionName.CountAll, () => this.formulaQuery.countAll(params[0]))
          .with(FunctionName.ArrayJoin, () => this.formulaQuery.arrayJoin(params[0], params[1]))
          .with(FunctionName.ArrayUnique, () => this.formulaQuery.arrayUnique(params))
          .with(FunctionName.ArrayFlatten, () => this.formulaQuery.arrayFlatten(params))
          .with(FunctionName.ArrayCompact, () => this.formulaQuery.arrayCompact(params))

          // System Functions
          .with(FunctionName.RecordId, () => this.formulaQuery.recordId())
          .with(FunctionName.AutoNumber, () => this.formulaQuery.autoNumber())
          .with(FunctionName.TextAll, () => this.formulaQuery.textAll(params[0]))

          .otherwise((fn) => {
            throw new Error(`Unsupported function: ${fn}`);
          })
      );
    };

    try {
      return execute();
    } finally {
      this.formulaQuery.setCallMetadata(undefined);
    }
  }

  visitBinaryOp(ctx: BinaryOpContext): string {
    const exprContexts = [ctx.expr(0), ctx.expr(1)];
    const paramMetadata = exprContexts.map((exprCtx) => this.buildParamMetadata(exprCtx));
    this.formulaQuery.setCallMetadata(paramMetadata);

    try {
      let left = exprContexts[0].accept(this);
      let right = exprContexts[1].accept(this);
      const operator = ctx._op;

      // For comparison operators, ensure operands are comparable to avoid
      // Postgres errors like "operator does not exist: text > integer".
      // If one side is number and the other is string, safely cast the string
      // side to numeric (driver-aware) before building the comparison.
      const leftType = this.inferExpressionType(exprContexts[0]);
      const rightType = this.inferExpressionType(exprContexts[1]);
      const needsNumericCoercion = (op: string) =>
        ['>', '<', '>=', '<=', '=', '!=', '<>'].includes(op);
      if (operator.text && needsNumericCoercion(operator.text)) {
        const isBooleanNumericCompare =
          (leftType === 'boolean' && rightType === 'number') ||
          (leftType === 'number' && rightType === 'boolean');
        if (isBooleanNumericCompare) {
          if (leftType === 'boolean') {
            left = this.coerceBooleanToNumeric(left, exprContexts[0]);
            right = this.safeCastToNumeric(right);
          } else {
            left = this.safeCastToNumeric(left);
            right = this.coerceBooleanToNumeric(right, exprContexts[1]);
          }
        } else if (leftType === 'number' && rightType === 'string') {
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
          const _leftType = this.inferExpressionType(exprContexts[0]);
          const _rightType = this.inferExpressionType(exprContexts[1]);
          const paramMetadata = [
            this.buildParamMetadata(exprContexts[0]),
            this.buildParamMetadata(exprContexts[1]),
          ];
          this.formulaQuery.setCallMetadata(paramMetadata);

          const forceNumericAddition = this.shouldForceNumericAddition();

          if (
            !forceNumericAddition &&
            (_leftType === 'string' ||
              _rightType === 'string' ||
              _leftType === 'datetime' ||
              _rightType === 'datetime')
          ) {
            const coercedLeft = this.coerceToStringForConcatenation(left, ctx.expr(0), _leftType);
            const coercedRight = this.coerceToStringForConcatenation(
              right,
              ctx.expr(1),
              _rightType
            );
            return this.formulaQuery.stringConcat(coercedLeft, coercedRight);
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
        .with('&&', () => {
          const normalizedLeft = this.normalizeBooleanExpression(left, ctx.expr(0));
          const normalizedRight = this.normalizeBooleanExpression(right, ctx.expr(1));
          return this.formulaQuery.logicalAnd(normalizedLeft, normalizedRight);
        })
        .with('||', () => {
          const normalizedLeft = this.normalizeBooleanExpression(left, ctx.expr(0));
          const normalizedRight = this.normalizeBooleanExpression(right, ctx.expr(1));
          return this.formulaQuery.logicalOr(normalizedLeft, normalizedRight);
        })
        .with('&', () => {
          // Always treat & as string concatenation to avoid type issues
          const leftType = this.inferExpressionType(ctx.expr(0));
          const rightType = this.inferExpressionType(ctx.expr(1));
          const paramMetadata = [
            this.buildParamMetadata(ctx.expr(0)),
            this.buildParamMetadata(ctx.expr(1)),
          ];
          this.formulaQuery.setCallMetadata(paramMetadata);
          const coercedLeft = this.coerceToStringForConcatenation(left, ctx.expr(0), leftType);
          const coercedRight = this.coerceToStringForConcatenation(right, ctx.expr(1), rightType);
          return this.formulaQuery.stringConcat(coercedLeft, coercedRight);
        })
        .otherwise((op) => {
          throw new Error(`Unsupported binary operator: ${op}`);
        });
    } finally {
      this.formulaQuery.setCallMetadata(undefined);
    }
  }

  private normalizeFunctionParamsForMultiplicity(
    fnName: FunctionName,
    params: string[],
    exprContexts: ExprContext[]
  ): string[] {
    const funcMeta = FUNCTIONS[fnName];
    if (!funcMeta) {
      return params;
    }

    return params.map((paramSql, index) => {
      if (funcMeta.acceptMultipleValue) {
        return paramSql;
      }

      if (this.shouldPreserveMultiValueParam(fnName, exprContexts[index], index, paramSql)) {
        return paramSql;
      }

      return this.reduceMultiFieldReferenceParam(exprContexts[index], paramSql);
    });
  }

  private tryBuildMultiValueAggregator(
    fnName: FunctionName,
    params: string[],
    exprContexts: ExprContext[]
  ): string | null {
    if (!exprContexts[0] || this.dialect?.driver !== DriverClient.Pg) {
      return null;
    }

    const isMulti = this.isMultiValueExpr(exprContexts[0], params[0]);
    if (!isMulti) {
      return null;
    }

    switch (fnName) {
      case FunctionName.DatetimeFormat: {
        const formatExpr = params[1] ?? `'YYYY-MM-DD HH:mm'`;
        return this.buildPgDatetimeFormatAggregator(params[0], formatExpr);
      }
      case FunctionName.Value:
        return this.buildPgNumericAggregator(params[0], (scalarText) =>
          this.formulaQuery.value(scalarText)
        );
      case FunctionName.Abs:
        return this.buildPgNumericAggregator(params[0], (scalarText) =>
          this.formulaQuery.abs(this.formulaQuery.value(scalarText))
        );
      case FunctionName.Datestr:
        return this.buildPgDatetimeScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.datestr(scalar)
        );
      case FunctionName.Timestr:
        return this.buildPgDatetimeScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.timestr(scalar)
        );
      case FunctionName.Day:
        return this.buildPgDatetimeScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.day(scalar)
        );
      case FunctionName.Month:
        return this.buildPgDatetimeScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.month(scalar)
        );
      case FunctionName.Year:
        return this.buildPgDatetimeScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.year(scalar)
        );
      case FunctionName.Weekday:
        return this.buildPgDatetimeScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.weekday(scalar, params[1])
        );
      case FunctionName.WeekNum:
        return this.buildPgDatetimeScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.weekNum(scalar)
        );
      case FunctionName.Hour:
        return this.buildPgDatetimeScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.hour(scalar)
        );
      case FunctionName.Minute:
        return this.buildPgDatetimeScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.minute(scalar)
        );
      case FunctionName.Second:
        return this.buildPgDatetimeScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.second(scalar)
        );
      case FunctionName.FromNow:
        return this.buildPgDatetimeScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.fromNow(scalar, params[1])
        );
      case FunctionName.ToNow:
        return this.buildPgDatetimeScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.toNow(scalar, params[1])
        );
      case FunctionName.Round:
        return this.buildPgNumericScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.round(scalar, params[1] ?? '0')
        );
      case FunctionName.RoundUp:
        return this.buildPgNumericScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.roundUp(scalar, params[1] ?? '0')
        );
      case FunctionName.RoundDown:
        return this.buildPgNumericScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.roundDown(scalar, params[1] ?? '0')
        );
      case FunctionName.Floor:
        return this.buildPgNumericScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.floor(scalar)
        );
      case FunctionName.Ceiling:
        return this.buildPgNumericScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.ceiling(scalar)
        );
      case FunctionName.Int:
        return this.buildPgNumericScalarAggregator(params[0], (scalar) =>
          this.formulaQuery.int(scalar)
        );
      default:
        return null;
    }
  }

  private shouldPreserveMultiValueParam(
    fnName: FunctionName,
    exprCtx: ExprContext,
    index: number,
    paramSql: string
  ): boolean {
    if (MULTI_VALUE_AGGREGATED_FUNCTIONS.has(fnName) && index === 0) {
      return true;
    }

    return this.isMultiValueExpr(exprCtx, paramSql);
  }

  private reduceMultiFieldReferenceParam(exprCtx: ExprContext, paramSql: string): string {
    if (!this.isMultiValueExpr(exprCtx, paramSql)) {
      return paramSql;
    }

    const fieldInfo = this.getFieldInfoFromExpr(exprCtx);
    if (fieldInfo) {
      return this.extractSingleValueFromMultiReference(paramSql, fieldInfo);
    }
    return paramSql;
  }

  private getFieldInfoFromExpr(exprCtx: ExprContext): FieldCore | undefined {
    if (!exprCtx) {
      return undefined;
    }

    if (exprCtx instanceof BracketsContext) {
      return this.getFieldInfoFromExpr(exprCtx.expr());
    }

    if (
      exprCtx instanceof LeftWhitespaceOrCommentsContext ||
      exprCtx instanceof RightWhitespaceOrCommentsContext
    ) {
      return this.getFieldInfoFromExpr(exprCtx.expr());
    }

    if (exprCtx instanceof FieldReferenceCurlyContext) {
      const normalizedFieldId = extractFieldReferenceId(exprCtx);
      const rawToken = getFieldReferenceTokenText(exprCtx);
      const fieldId = normalizedFieldId ?? rawToken?.slice(1, -1)?.trim() ?? '';
      if (!fieldId) {
        return undefined;
      }
      return this.context.table.getField(fieldId);
    }

    return undefined;
  }

  private isMultiValueField(fieldInfo?: FieldCore): boolean {
    if (!fieldInfo) {
      return false;
    }

    const fieldType = fieldInfo.type as FieldType;
    const lookupHolder = fieldInfo as unknown as {
      isLookup?: boolean;
      dbFieldName?: string;
      lookupOptions?: { linkFieldId?: string };
      isMultipleCellValue?: boolean;
    };

    // Link fields: only treat as multi-value when the relationship is multi or explicitly flagged.
    if (fieldType === FieldType.Link) {
      return this.isLinkFieldMulti(fieldInfo);
    }

    const isLookupField =
      lookupHolder.isLookup === true ||
      lookupHolder.dbFieldName?.startsWith('lookup_') ||
      lookupHolder.dbFieldName?.startsWith('conditional_lookup_');

    // Lookup of link: mirror the link field multiplicity instead of assuming array values.
    if (isLookupField && lookupHolder.lookupOptions?.linkFieldId) {
      const linkField = this.context.table.getField(lookupHolder.lookupOptions.linkFieldId);
      if (this.isLinkFieldMulti(linkField as FieldCore | undefined)) {
        return true;
      }
    }

    if (lookupHolder.isMultipleCellValue) {
      return true;
    }

    // For lookup fields that are not multi-value (e.g., many-one link lookup), stop here to avoid
    // treating scalar JSON objects as arrays.
    if (isLookupField) {
      return false;
    }

    if (MULTI_VALUE_FIELD_TYPES.has(fieldType)) {
      return true;
    }

    return false;
  }

  private isLinkFieldMulti(linkField?: FieldCore): boolean {
    if (!linkField) {
      return false;
    }
    if ((linkField as unknown as { isMultipleCellValue?: boolean })?.isMultipleCellValue) {
      return true;
    }
    const relationship = (
      linkField as unknown as {
        options?: { relationship?: Relationship };
      }
    ).options?.relationship;
    if (!relationship) {
      return false;
    }
    return relationship === Relationship.ManyMany || relationship === Relationship.OneMany;
  }

  private isMultiValueExpr(exprCtx: ExprContext, paramSql?: string): boolean {
    if (exprCtx instanceof BracketsContext) {
      return this.isMultiValueExpr(exprCtx.expr(), paramSql);
    }

    if (
      exprCtx instanceof LeftWhitespaceOrCommentsContext ||
      exprCtx instanceof RightWhitespaceOrCommentsContext
    ) {
      return this.isMultiValueExpr(exprCtx.expr(), paramSql);
    }

    const fieldInfo = this.getFieldInfoFromExpr(exprCtx);
    if (fieldInfo) {
      // When we have metadata for the referenced field, trust it instead of falling back to
      // string-based heuristics (which misclassify scalar lookups/rollups whose dbFieldName
      // happens to contain "lookup_").
      return this.isMultiValueField(fieldInfo);
    }

    if (exprCtx instanceof FunctionCallContext) {
      const rawName = exprCtx.func_name().text.toUpperCase();
      const fnName = normalizeFunctionNameAlias(rawName) as FunctionName;
      if (
        fnName === FunctionName.ArrayUnique ||
        fnName === FunctionName.ArrayFlatten ||
        fnName === FunctionName.ArrayCompact
      ) {
        return true;
      }
    }

    // Only attempt SQL-based heuristics for unresolved direct field references.
    // For composite expressions (binary ops, comparisons, nested functions), the presence of
    // "link_value"/"lookup_" fragments does not imply the *result* is multi-value.
    if (exprCtx instanceof FieldReferenceCurlyContext && paramSql) {
      const lookupMatch = paramSql.match(/lookup_(fld[A-Za-z0-9]+)/);
      if (lookupMatch && this.context?.table) {
        const referencedField = this.context.table.getField(lookupMatch[1]);
        if (referencedField) {
          return this.isMultiValueField(referencedField as FieldCore);
        }
      }
    }

    return false;
  }

  private extractSingleValueFromMultiReference(expr: string, fieldInfo: FieldCore): string {
    if (!this.dialect) {
      return expr;
    }

    switch (this.dialect.driver) {
      case DriverClient.Pg:
        return this.buildPgSingleValueExtractor(expr, fieldInfo);
      case DriverClient.Sqlite:
        return this.buildSqliteSingleValueExtractor(expr);
      default:
        return expr;
    }
  }

  private buildSqliteSingleValueExtractor(expr: string): string {
    // SQLite formulas already treat multi-value columns as JSON text during coercion.
    // Returning the original expression keeps existing behaviour consistent.
    return expr;
  }

  private buildPgSingleValueExtractor(expr: string, _fieldInfo: FieldCore): string {
    const fieldInfo = _fieldInfo;
    const normalizedJson = this.normalizeMultiValueExprToJson(expr);

    const firstElement = `(SELECT elem
      FROM jsonb_array_elements(${normalizedJson}) WITH ORDINALITY AS t(elem, ord)
      WHERE jsonb_typeof(elem) <> 'null'
      ORDER BY ord
      LIMIT 1
    )`;

    const scalarJson = `(CASE
      WHEN ${normalizedJson} IS NULL THEN NULL::jsonb
      WHEN jsonb_typeof(${normalizedJson}) = 'array' THEN ${firstElement}
      ELSE ${normalizedJson}
    END)`;

    return `(CASE
      WHEN ${scalarJson} IS NULL THEN NULL
      WHEN jsonb_typeof(${scalarJson}) = 'object' THEN COALESCE(
        ${scalarJson}->>'title',
        ${scalarJson}->>'name',
        (${scalarJson})::text
      )
      WHEN jsonb_typeof(${scalarJson}) = 'array' THEN NULL
      ELSE ${this.formatScalarDatetimeIfNeeded(`${scalarJson} #>> '{}'`, fieldInfo)}
    END)`;
  }

  private formatScalarDatetimeIfNeeded(scalar: string, fieldInfo: FieldCore): string {
    if (this.context?.isGeneratedColumn) {
      return scalar;
    }
    const isDatetimeCell =
      (fieldInfo as unknown as { cellValueType?: CellValueType })?.cellValueType ===
        CellValueType.DateTime || fieldInfo.dbFieldType === DbFieldType.DateTime;

    if (!isDatetimeCell || !this.dialect || typeof this.dialect.formatDate !== 'function') {
      return scalar;
    }

    const formatting = this.getFieldDatetimeFormatting(fieldInfo);
    const fallBackFormatting: IDatetimeFormatting = {
      date: DateFormattingPreset.ISO,
      time: TimeFormatting.Hour24,
      timeZone: this.context?.timeZone ?? 'UTC',
    };

    return this.dialect.formatDate(scalar, formatting ?? fallBackFormatting);
  }

  private normalizeMultiValueExprToJson(expr: string): string {
    const baseExpr = `(${expr})`;
    const coercedJson = `(CASE
      WHEN ${baseExpr} IS NULL THEN NULL::jsonb
      WHEN pg_typeof(${baseExpr}) = 'jsonb'::regtype THEN (${baseExpr})::text::jsonb
      WHEN pg_typeof(${baseExpr}) = 'json'::regtype THEN (${baseExpr})::text::jsonb
      WHEN pg_typeof(${baseExpr}) IN ('text', 'varchar', 'bpchar', 'character varying', 'unknown') THEN
        CASE
          WHEN NULLIF(BTRIM((${baseExpr})::text), '') IS NULL THEN NULL::jsonb
          WHEN LEFT(BTRIM((${baseExpr})::text), 1) = '[' THEN (${baseExpr})::text::jsonb
          ELSE jsonb_build_array(to_jsonb(${baseExpr}))
        END
      ELSE to_jsonb(${baseExpr})
    END)`;
    return `(CASE
      WHEN ${coercedJson} IS NULL THEN NULL::jsonb
      WHEN jsonb_typeof(${coercedJson}) = 'array' THEN ${coercedJson}
      ELSE jsonb_build_array(${coercedJson})
    END)`;
  }

  private extractJsonScalarText(elemRef: string): string {
    return `(CASE
      WHEN jsonb_typeof(${elemRef}) = 'object' THEN COALESCE(${elemRef}->>'title', ${elemRef}->>'name', ${elemRef} #>> '{}')
      WHEN jsonb_typeof(${elemRef}) = 'array' THEN NULL
      ELSE ${elemRef} #>> '{}'
    END)`;
  }

  private buildPgNumericAggregator(
    valueExpr: string,
    buildNumericExpr: (scalarTextExpr: string) => string
  ): string {
    const normalizedJson = this.normalizeMultiValueExprToJson(valueExpr);
    const scalarText = this.extractJsonScalarText('elem');
    const numericExpr = buildNumericExpr(scalarText);
    const formattedExpr = `(CASE WHEN ${numericExpr} IS NULL THEN NULL ELSE ${numericExpr} END)`;
    const aggregated = this.dialect!.stringAggregate(formattedExpr, ', ', 'ord');
    return `(CASE
      WHEN ${normalizedJson} IS NULL THEN NULL
      ELSE (
        SELECT ${aggregated}
        FROM jsonb_array_elements(${normalizedJson}) WITH ORDINALITY AS t(elem, ord)
      )
    END)`;
  }

  private buildPgDatetimeFormatAggregator(valueExpr: string, formatExpr: string): string {
    return this.buildPgDatetimeScalarAggregator(valueExpr, (scalar) =>
      this.formulaQuery.datetimeFormat(scalar, formatExpr)
    );
  }

  private buildPgNumericScalarAggregator(
    valueExpr: string,
    buildScalarExpr: (numericScalar: string) => string
  ): string {
    const normalizedJson = this.normalizeMultiValueExprToJson(valueExpr);
    const elementScalar = this.extractJsonScalarText('elem');
    const sanitizedScalar = `NULLIF(${elementScalar}, '')`;
    const numericScalar = this.formulaQuery.value(sanitizedScalar);
    const computedExpr = buildScalarExpr(numericScalar);
    const safeExpr = `(CASE WHEN ${numericScalar} IS NULL THEN NULL ELSE (${computedExpr})::text END)`;
    const aggregated = this.dialect!.stringAggregate(safeExpr, ', ', 'ord');
    return `(CASE
      WHEN ${normalizedJson} IS NULL THEN NULL
      ELSE (
        SELECT ${aggregated}
        FROM jsonb_array_elements(${normalizedJson}) WITH ORDINALITY AS t(elem, ord)
      )
    END)`;
  }

  private buildPgDatetimeScalarAggregator(
    valueExpr: string,
    buildScalarExpr: (sanitizedScalar: string) => string
  ): string {
    const normalizedJson = this.normalizeMultiValueExprToJson(valueExpr);
    const elementScalar = this.extractJsonScalarText('elem');
    const sanitizedScalar = `NULLIF(${elementScalar}, '')`;
    const computedExpr = buildScalarExpr(sanitizedScalar);
    const safeExpr = `(CASE WHEN ${sanitizedScalar} IS NULL THEN NULL ELSE (${computedExpr})::text END)`;
    const aggregated = this.dialect!.stringAggregate(safeExpr, ', ', 'ord');
    return `(CASE
      WHEN ${normalizedJson} IS NULL THEN NULL
      ELSE (
        SELECT ${aggregated}
        FROM jsonb_array_elements(${normalizedJson}) WITH ORDINALITY AS t(elem, ord)
      )
    END)`;
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
   * Normalize a boolean expression into a numeric scalar (1/0) for cross-type comparisons.
   * Preserves NULL so equality checks against NULL behave as expected.
   */
  private coerceBooleanToNumeric(value: string, exprCtx?: ExprContext): string {
    const normalized =
      exprCtx && exprCtx instanceof FieldReferenceCurlyContext
        ? this.normalizeBooleanFieldReference(value, exprCtx) ?? value
        : value;
    const boolExpr = `(${normalized})`;
    return `(CASE WHEN ${boolExpr} IS NULL THEN NULL WHEN ${boolExpr} THEN 1 ELSE 0 END)::numeric`;
  }

  /**
   * Coerce values participating in string concatenation to textual representation when needed.
   * Datetime operands are cast to string to mirror client-side behaviour and to avoid relying
   * on database-specific implicit casts that may be non-immutable for generated columns.
   */
  private coerceToStringForConcatenation(
    value: string,
    exprCtx: ExprContext,
    inferredType?: 'string' | 'number' | 'boolean' | 'datetime' | 'unknown'
  ): string {
    let fieldInfo: FieldCore | undefined;
    let normalizedValue = value;
    let coercedMultiToString = false;
    if (exprCtx instanceof FieldReferenceCurlyContext) {
      const normalizedFieldId = extractFieldReferenceId(exprCtx);
      const rawToken = getFieldReferenceTokenText(exprCtx);
      const fieldId = normalizedFieldId ?? rawToken?.slice(1, -1)?.trim() ?? '';
      fieldInfo = this.context.table.getField(fieldId);
      const isMultiField = this.isMultiValueField(fieldInfo as FieldCore);
      const cellValueType = (fieldInfo as unknown as { cellValueType?: CellValueType })
        ?.cellValueType;
      const hasDatetimeSemantics =
        (fieldInfo && DATETIME_FIELD_TYPES.has(fieldInfo.type as FieldType)) ||
        cellValueType === CellValueType.DateTime ||
        fieldInfo?.dbFieldType === DbFieldType.DateTime;
      if (
        fieldInfo &&
        (fieldInfo as unknown as { cellValueType?: CellValueType })?.cellValueType ===
          CellValueType.DateTime
      ) {
        // Keep a note that this value carries datetime semantics even when inferred as string
        inferredType = inferredType === undefined ? 'datetime' : inferredType;
      }
      if (isMultiField && this.dialect) {
        // Normalize multi-value references (lookup, link, multi-select, etc.) into a deterministic
        // comma-separated string so downstream text operations behave as expected.
        if (
          fieldInfo &&
          hasDatetimeSemantics &&
          typeof this.dialect.formatDateArray === 'function'
        ) {
          const formatting =
            this.getFieldDatetimeFormatting(fieldInfo) ??
            ({
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.Hour24,
              timeZone: this.context?.timeZone ?? 'UTC',
            } as IDatetimeFormatting);
          normalizedValue = this.dialect.formatDateArray(value, formatting);
        } else {
          normalizedValue = this.dialect.formatStringArray(value, { fieldInfo });
        }
        coercedMultiToString = true;
      }
    }
    const type = coercedMultiToString
      ? 'string'
      : inferredType ?? this.inferExpressionType(exprCtx);
    if (type === 'datetime') {
      const fallBackFormatting: IDatetimeFormatting = {
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.Hour24,
        timeZone: this.context?.timeZone ?? 'UTC',
      };
      const formatting = fieldInfo ? this.getFieldDatetimeFormatting(fieldInfo) : undefined;
      if (this.dialect?.formatDate) {
        return this.dialect.formatDate(normalizedValue, formatting ?? fallBackFormatting);
      }
      return this.formulaQuery.datetimeFormat(normalizedValue, "'YYYY-MM-DD HH24:MI'");
    }
    return normalizedValue;
  }

  private getFieldDatetimeFormatting(fieldInfo: FieldCore): IDatetimeFormatting | undefined {
    const rawOptions = (fieldInfo as unknown as { options?: unknown })?.options;
    const formatting =
      rawOptions && typeof rawOptions === 'object'
        ? (rawOptions as { formatting?: IDatetimeFormatting }).formatting
        : typeof rawOptions === 'string'
          ? (() => {
              try {
                return (JSON.parse(rawOptions) as { formatting?: IDatetimeFormatting } | undefined)
                  ?.formatting;
              } catch {
                return undefined;
              }
            })()
          : undefined;
    if (formatting) return formatting;

    const getter = (
      fieldInfo as unknown as {
        getDatetimeFormatting?: () => IDatetimeFormatting | undefined;
      }
    )?.getDatetimeFormatting;
    if (typeof getter === 'function') {
      return getter.call(fieldInfo);
    }

    return undefined;
  }

  private shouldForceNumericAddition(): boolean {
    const selectContext = this.context as ISelectFormulaConversionContext | undefined;
    const targetType = selectContext?.targetDbFieldType;
    return targetType === DbFieldType.Integer || targetType === DbFieldType.Real;
  }

  private coerceCaseBranchToText(expr: string): string {
    const trimmed = expr.trim();
    const driver = this.context.driverClient ?? DriverClient.Pg;

    // eslint-disable-next-line regexp/prefer-w
    const nullPattern = /^NULL(?:::[a-zA-Z_][a-zA-Z0-9_\s]*)?$/i;
    if (!trimmed || nullPattern.test(trimmed)) {
      return driver === DriverClient.Sqlite ? 'CAST(NULL AS TEXT)' : 'NULL::text';
    }

    const isStringLiteral = trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'");
    if (isStringLiteral) {
      return expr;
    }

    if (driver === DriverClient.Sqlite) {
      const upper = trimmed.toUpperCase();
      if (upper.startsWith('CAST(') && upper.endsWith('AS TEXT)')) {
        return expr;
      }
      return `CAST(${expr} AS TEXT)`;
    }

    if (/::\s*text\b/i.test(trimmed) || /\)::\s*text\b/i.test(trimmed)) {
      return expr;
    }

    return `(${expr})::text`;
  }

  private normalizeTextSliceCount(valueSql?: string, exprCtx?: ExprContext): string {
    if (!valueSql || !exprCtx) {
      return '1';
    }

    const trimmedLiteral = valueSql.trim();
    if (/^[-+]?\d+(\.\d+)?$/.test(trimmedLiteral)) {
      const literalNumber = Math.floor(Number(trimmedLiteral));
      const clamped = Number.isFinite(literalNumber) ? Math.max(literalNumber, 0) : 0;
      return clamped.toString();
    }

    const type = this.inferExpressionType(exprCtx);
    const driver = this.context.driverClient ?? DriverClient.Pg;

    if (type === 'boolean') {
      if (driver === DriverClient.Sqlite) {
        return `(CASE WHEN ${valueSql} IS NULL THEN 0 WHEN ${valueSql} <> 0 THEN 1 ELSE 0 END)`;
      }
      return `(CASE WHEN ${valueSql} IS NULL THEN 0 WHEN ${valueSql} THEN 1 ELSE 0 END)`;
    }

    const numericExpr = this.safeCastToNumeric(valueSql);
    if (driver === DriverClient.Sqlite) {
      const flooredExpr = `CAST(${numericExpr} AS INTEGER)`;
      return `COALESCE(CASE WHEN ${flooredExpr} < 0 THEN 0 ELSE ${flooredExpr} END, 0)`;
    }
    const flooredExpr = `FLOOR(${numericExpr})`;
    return `COALESCE(GREATEST(${flooredExpr}, 0), 0)`;
  }
  private normalizeBooleanExpression(valueSql: string, exprCtx: ExprContext): string {
    const type = this.inferExpressionType(exprCtx);
    const driver = this.context.driverClient ?? DriverClient.Pg;

    switch (type) {
      case 'boolean':
        if (driver === DriverClient.Sqlite) {
          return `(COALESCE((${valueSql}), 0) != 0)`;
        }
        return `(COALESCE((${this.normalizeBooleanFieldReference(valueSql, exprCtx) ?? valueSql})::boolean, FALSE))`;
      case 'number': {
        if (driver === DriverClient.Sqlite) {
          const numericExpr = this.safeCastToNumeric(valueSql);
          return `(COALESCE(${numericExpr}, 0) <> 0)`;
        }
        const sanitized = `REGEXP_REPLACE(((${valueSql})::text), '[^0-9.+-]', '', 'g')`;
        const numericCandidate = `(CASE
          WHEN ${sanitized} ~ '^[-+]{0,1}(\\d+\\.\\d+|\\d+|\\.\\d+)$' THEN ${sanitized}::double precision
          ELSE NULL
        END)`;
        return `(COALESCE(${numericCandidate}, 0) <> 0)`;
      }
      case 'string': {
        if (driver === DriverClient.Sqlite) {
          const textExpr = `CAST(${valueSql} AS TEXT)`;
          const trimmedExpr = `TRIM(${textExpr})`;
          return `((${valueSql}) IS NOT NULL AND ${trimmedExpr} <> '' AND LOWER(${trimmedExpr}) <> 'null')`;
        }
        const textExpr = `(${valueSql})::text`;
        const trimmedExpr = `TRIM(${textExpr})`;
        return `((${valueSql}) IS NOT NULL AND ${trimmedExpr} <> '' AND LOWER(${trimmedExpr}) <> 'null')`;
      }
      case 'datetime':
        return `((${valueSql}) IS NOT NULL)`;
      default:
        return `((${valueSql}) IS NOT NULL)`;
    }
  }

  /**
   * Coerce direct field references carrying boolean semantics into a proper boolean scalar.
   * This keeps the SQL maintainable by leveraging schema metadata rather than runtime pg_typeof checks.
   */
  private normalizeBooleanFieldReference(valueSql: string, exprCtx: ExprContext): string | null {
    if (!(exprCtx instanceof FieldReferenceCurlyContext)) {
      return null;
    }

    const normalizedFieldId = extractFieldReferenceId(exprCtx);
    const rawToken = getFieldReferenceTokenText(exprCtx);
    const fieldId = normalizedFieldId ?? rawToken?.slice(1, -1)?.trim() ?? '';
    const fieldInfo = this.context.table?.getField(fieldId);
    if (!fieldInfo) {
      return null;
    }

    const isBooleanField =
      fieldInfo.dbFieldType === DbFieldType.Boolean || fieldInfo.cellValueType === 'boolean';
    if (!isBooleanField) {
      return null;
    }

    return `((${valueSql}))::boolean`;
  }

  private isBlankLikeExpression(ctx: ExprContext): boolean {
    if (ctx instanceof StringLiteralContext) {
      const raw = ctx.text;
      if (raw.startsWith("'") && raw.endsWith("'")) {
        const unescaped = unescapeString(raw.slice(1, -1));
        return unescaped === '';
      }
      return false;
    }

    if (ctx instanceof FunctionCallContext) {
      const rawName = ctx.func_name().text.toUpperCase();
      const fnName = normalizeFunctionNameAlias(rawName) as FunctionName;
      return fnName === FunctionName.Blank;
    }

    return false;
  }
  /**
   * Infer the type of an expression for type-aware operations
   */
  private inferExpressionType(
    ctx: ExprContext
  ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
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
  private inferLiteralType(
    ctx: ExprContext
  ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
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
  ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
    const { fieldInfo } = this.resolveFieldReference(ctx);

    if (!fieldInfo) {
      return 'unknown';
    }

    if (
      fieldInfo.isMultipleCellValue ||
      (fieldInfo.isLookup && fieldInfo.dbFieldType === DbFieldType.Json)
    ) {
      // Multi-value fields (e.g. lookups) are materialized as JSON arrays even when the
      // referenced cellValueType is datetime. Treat them as strings to avoid pushing JSON
      // expressions through datetime-specific casts like ::timestamptz, which PostgreSQL
      // rejects at runtime.
      return 'string';
    }

    if (!fieldInfo.type) {
      return 'unknown';
    }

    return this.mapFieldTypeToBasicType(fieldInfo);
  }

  private resolveFieldReference(ctx: FieldReferenceCurlyContext): {
    fieldId: string;
    fieldInfo?: FieldCore;
  } {
    const normalizedFieldId = extractFieldReferenceId(ctx);
    const rawToken = getFieldReferenceTokenText(ctx);
    const fieldId = normalizedFieldId ?? rawToken?.slice(1, -1)?.trim() ?? '';
    const fieldInfo = this.context.table.getField(fieldId);
    return { fieldId, fieldInfo };
  }

  private buildParamMetadata(exprCtx: ExprContext): IFormulaParamMetadata {
    const type = this.inferExpressionType(exprCtx) as FormulaParamType;
    const fieldRef = this.extractFieldReferenceMetadata(exprCtx);
    if (fieldRef) {
      const { fieldId, fieldInfo } = fieldRef;
      const fieldMetadata: IFormulaParamFieldMetadata = {
        id: fieldId,
        type: fieldInfo?.type as FieldType | undefined,
        cellValueType: fieldInfo?.cellValueType,
        isMultiple: Boolean(fieldInfo?.isMultipleCellValue),
        isLookup: Boolean(fieldInfo?.isLookup),
        dbFieldName: fieldInfo?.dbFieldName,
        dbFieldType: fieldInfo?.dbFieldType,
      };
      return {
        type,
        isFieldReference: true,
        field: fieldMetadata,
      };
    }
    return {
      type,
      isFieldReference: false,
    };
  }

  private extractFieldReferenceMetadata(
    exprCtx: ExprContext
  ): { fieldId: string; fieldInfo?: FieldCore } | undefined {
    if (exprCtx instanceof FieldReferenceCurlyContext) {
      return this.resolveFieldReference(exprCtx);
    }
    if (exprCtx instanceof BracketsContext) {
      return this.extractFieldReferenceMetadata(exprCtx.expr());
    }
    if (exprCtx instanceof LeftWhitespaceOrCommentsContext) {
      return this.extractFieldReferenceMetadata(exprCtx.expr());
    }
    if (exprCtx instanceof RightWhitespaceOrCommentsContext) {
      return this.extractFieldReferenceMetadata(exprCtx.expr());
    }
    return undefined;
  }

  /**
   * Map field types to basic types
   */
  private mapFieldTypeToBasicType(
    fieldInfo: FieldCore
  ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
    const { type, cellValueType } = fieldInfo;
    const typeEnum = type as FieldType;

    if (STRING_FIELD_TYPES.has(typeEnum)) {
      return 'string';
    }

    if (DATETIME_FIELD_TYPES.has(typeEnum)) {
      return 'datetime';
    }

    if (NUMBER_FIELD_TYPES.has(typeEnum)) {
      return 'number';
    }

    if (typeEnum === FieldType.Checkbox) {
      return 'boolean';
    }

    if (
      typeEnum === FieldType.Formula ||
      typeEnum === FieldType.Rollup ||
      typeEnum === FieldType.ConditionalRollup
    ) {
      if (cellValueType) {
        return this.mapCellValueTypeToBasicType(cellValueType);
      }
      return 'unknown';
    }

    if (cellValueType) {
      return this.mapCellValueTypeToBasicType(cellValueType);
    }

    return 'unknown';
  }

  /**
   * Map cell value types to basic types
   */
  private mapCellValueTypeToBasicType(
    cellValueType: string
  ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
    switch (cellValueType) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'datetime':
      case 'dateTime':
        return 'datetime';
      default:
        return 'unknown';
    }
  }

  /**
   * Infer return type from function calls
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private inferFunctionReturnType(
    ctx: FunctionCallContext
  ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
    const rawName = ctx.func_name().text.toUpperCase();
    const fnName = normalizeFunctionNameAlias(rawName) as FunctionName;

    if (STRING_FUNCTIONS.has(fnName)) {
      return 'string';
    }

    if (NUMBER_FUNCTIONS.has(fnName)) {
      return 'number';
    }

    if (BOOLEAN_FUNCTIONS.has(fnName)) {
      return 'boolean';
    }

    if (fnName === FunctionName.If) {
      const [, trueExpr, falseExpr] = ctx.expr();
      const trueType = trueExpr ? this.inferExpressionType(trueExpr) : 'unknown';
      const falseType = falseExpr ? this.inferExpressionType(falseExpr) : 'unknown';

      if (!falseExpr) {
        return trueType;
      }

      if (!trueExpr) {
        return falseType;
      }

      if (trueType === falseType) {
        return trueType;
      }

      if (trueType === 'number' || falseType === 'number') {
        const trueIsBlank = this.isBlankLikeExpression(trueExpr);
        const falseIsBlank = this.isBlankLikeExpression(falseExpr);
        if (trueType === 'number' && (falseIsBlank || falseType === 'number')) {
          return 'number';
        }
        if (falseType === 'number' && (trueIsBlank || trueType === 'number')) {
          return 'number';
        }
      }

      if (trueType === 'datetime' && falseType === 'datetime') {
        return 'datetime';
      }

      return 'unknown';
    }

    if (fnName === FunctionName.Switch) {
      const exprContexts = ctx.expr();
      const resultExprs: ExprContext[] = [];

      for (let i = 2; i < exprContexts.length; i += 2) {
        resultExprs.push(exprContexts[i]);
      }

      if (exprContexts.length % 2 === 0 && exprContexts.length > 1) {
        resultExprs.push(exprContexts[exprContexts.length - 1]);
      }

      if (resultExprs.length === 0) {
        return 'unknown';
      }

      const resultTypes = resultExprs.map((expr) => this.inferExpressionType(expr));
      const nonUnknownTypes = resultTypes.filter((type) => type !== 'unknown');

      if (nonUnknownTypes.length === 0) {
        return 'unknown';
      }

      const firstType = nonUnknownTypes[0];
      if (nonUnknownTypes.every((type) => type === firstType)) {
        return firstType;
      }

      const hasNumber = nonUnknownTypes.includes('number');
      const hasDatetime = nonUnknownTypes.includes('datetime');
      const hasBoolean = nonUnknownTypes.includes('boolean');

      if (hasNumber) {
        const convertibleToNumber = resultExprs.every((expr, index) => {
          const type = resultTypes[index];
          return type === 'number' || this.isBlankLikeExpression(expr);
        });
        if (convertibleToNumber) {
          return 'number';
        }
      }

      if (hasDatetime) {
        const convertibleToDatetime = resultExprs.every((expr, index) => {
          const type = resultTypes[index];
          return type === 'datetime' || this.isBlankLikeExpression(expr);
        });
        if (convertibleToDatetime) {
          return 'datetime';
        }
      }

      if (hasBoolean) {
        const convertibleToBoolean = resultExprs.every((expr, index) => {
          const type = resultTypes[index];
          return type === 'boolean' || this.isBlankLikeExpression(expr);
        });
        if (convertibleToBoolean) {
          return 'boolean';
        }
      }

      return 'unknown';
    }

    // Basic detection for functions that yield datetime
    if (
      [
        FunctionName.CreatedTime,
        FunctionName.LastModifiedTime,
        FunctionName.Today,
        FunctionName.Now,
        FunctionName.DateAdd,
        FunctionName.DatetimeParse,
      ].includes(fnName)
    ) {
      return 'datetime';
    }

    return 'unknown';
  }

  /**
   * Infer type from binary operations
   */
  private inferBinaryOperationType(
    ctx: BinaryOpContext
  ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
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

      if (leftType === 'datetime' || rightType === 'datetime') {
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
    const normalizedFieldId = extractFieldReferenceId(ctx);
    const rawToken = getFieldReferenceTokenText(ctx);
    const fieldId = normalizedFieldId ?? rawToken?.slice(1, -1)?.trim() ?? '';
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
    const normalizedFieldId = extractFieldReferenceId(ctx);
    const rawToken = getFieldReferenceTokenText(ctx);
    const fieldId = normalizedFieldId ?? rawToken?.slice(1, -1).trim() ?? '';

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
    const preferRaw = !!selectContext.preferRawFieldReferences;
    const selectionMap = selectContext.selectionMap;
    const selection = selectionMap?.get(fieldId);
    let selectionSql = typeof selection === 'string' ? selection : selection?.toSQL().sql;
    const cteMap = selectContext.fieldCteMap;
    const readyLinkFieldIds =
      selectContext.readyLinkFieldIds &&
      typeof (selectContext.readyLinkFieldIds as { has?: unknown }).has === 'function'
        ? (selectContext.readyLinkFieldIds as ReadonlySet<string>)
        : undefined;
    const isSelfReference = selectContext.currentLinkFieldId === fieldId;
    // For link fields with CTE mapping, use the CTE directly
    // No need for complex cross-CTE reference handling in most cases

    // Handle different field types that use CTEs
    if (isLinkField(fieldInfo)) {
      // Prefer direct column when raw references are requested; otherwise fallback to CTE mapping.
      // However, when the field is not already part of the current selection (common when resolving
      // display fields for nested link CTEs), we still need to reference the CTE to access the link
      // value even in raw contexts; otherwise formulas that reference link fields end up reading
      // NULL placeholders instead of the computed JSON payload.
      const cteName = cteMap?.get(fieldId);
      const isReady = !readyLinkFieldIds || readyLinkFieldIds.has(fieldId);
      const canReferenceCte = !preferRaw && !isSelfReference && !!cteName && isReady;
      if (canReferenceCte) {
        selectionSql = `"${cteName}"."link_value"`;
      } else if (!preferRaw && !isSelfReference && cteName && selectContext.tableAlias && isReady) {
        const tableAlias = selectContext.tableAlias;
        // Use a scalar subquery when the CTE isn't joined in scope but is available in WITH.
        selectionSql = `(SELECT "${cteName}"."link_value" FROM "${cteName}" WHERE "${cteName}"."main_record_id" = "${tableAlias}"."__id")`;
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

    if (
      preferRaw &&
      (fieldInfo.isLookup ||
        fieldInfo.type === FieldType.Rollup ||
        fieldInfo.type === FieldType.ConditionalRollup)
    ) {
      const tableAlias = selectContext.tableAlias;
      const directRef = tableAlias
        ? `"${tableAlias}"."${fieldInfo.dbFieldName}"`
        : `"${fieldInfo.dbFieldName}"`;
      if (fieldInfo.isLookup) {
        const normalized = this.normalizeLookupSelection(directRef, fieldInfo, selectContext);
        if (normalized !== directRef) {
          return normalized;
        }
      }
      return this.coerceRawMultiValueReference(directRef, fieldInfo, selectContext);
    }

    if (preferRaw && shouldExpandFieldReference(fieldInfo)) {
      const tableAlias = selectContext.tableAlias;
      const directRef = tableAlias
        ? `"${tableAlias}"."${fieldInfo.dbFieldName}"`
        : `"${fieldInfo.dbFieldName}"`;
      return this.coerceRawMultiValueReference(directRef, fieldInfo, selectContext);
    }

    // Check if this is a formula field that needs recursive expansion
    if (shouldExpandFieldReference(fieldInfo)) {
      return this.expandFormulaField(fieldId, fieldInfo);
    }

    // If this is a lookup or rollup and CTE map is available, use it
    const linkLookupOptions =
      fieldInfo.lookupOptions && isLinkLookupOptions(fieldInfo.lookupOptions)
        ? fieldInfo.lookupOptions
        : undefined;
    const linkLookupLinkId = linkLookupOptions?.linkFieldId;
    const canReferenceLookupCte =
      !preferRaw &&
      !!cteMap &&
      !!linkLookupLinkId &&
      cteMap.has(linkLookupLinkId) &&
      (!readyLinkFieldIds || readyLinkFieldIds.has(linkLookupLinkId)) &&
      selectContext.currentLinkFieldId !== linkLookupLinkId;
    if (canReferenceLookupCte) {
      const cteName = cteMap!.get(linkLookupLinkId!)!;
      const columnName = fieldInfo.isLookup
        ? `lookup_${fieldInfo.id}`
        : (fieldInfo as unknown as { type?: string }).type === 'rollup'
          ? `rollup_${fieldInfo.id}`
          : undefined;
      if (columnName) {
        let columnRef = `"${cteName}"."${columnName}"`;
        if (preferRaw && fieldInfo.type !== FieldType.Link) {
          const adjusted = this.coerceRawMultiValueReference(columnRef, fieldInfo, selectContext);
          if (selectContext.targetDbFieldType === DbFieldType.Json) {
            return adjusted;
          }
          columnRef = adjusted;
        }
        if (
          fieldInfo.type === FieldType.Link &&
          fieldInfo.isLookup &&
          isLinkLookupOptions(fieldInfo.lookupOptions)
        ) {
          if (preferRaw && selectContext.targetDbFieldType === DbFieldType.Json) {
            return columnRef;
          }
          if (fieldInfo.dbFieldType !== DbFieldType.Json) {
            return columnRef;
          }
          const titlesExpr = this.dialect!.linkExtractTitles(
            columnRef,
            !!fieldInfo.isMultipleCellValue
          );
          if (fieldInfo.isMultipleCellValue) {
            return this.dialect!.formatStringArray(titlesExpr, { fieldInfo });
          }
          return titlesExpr;
        }
        return columnRef;
      }
    }

    // Handle user-related fields
    if (fieldInfo.type === FieldType.CreatedBy) {
      // For system user fields, derive directly from system columns to avoid JSON dependency
      const alias = selectContext.tableAlias;
      const idRef = alias ? `"${alias}"."__created_by"` : `"__created_by"`;
      return this.dialect!.selectUserNameById(idRef);
    }
    if (fieldInfo.type === FieldType.LastModifiedBy) {
      const trackAll = (fieldInfo as LastModifiedByFieldCore).isTrackAll();
      if (trackAll) {
        const alias = selectContext.tableAlias;
        const idRef = alias ? `"${alias}"."__last_modified_by"` : `"__last_modified_by"`;
        return this.dialect!.selectUserNameById(idRef);
      }
      if (!selectionSql) {
        if (selectContext.tableAlias) {
          selectionSql = `"${selectContext.tableAlias}"."${fieldInfo.dbFieldName}"`;
        } else {
          selectionSql = `"${fieldInfo.dbFieldName}"`;
        }
      }
      if (preferRaw && selectContext.targetDbFieldType === DbFieldType.Json) {
        if (fieldInfo.isMultipleCellValue) {
          return this.dialect!.linkExtractTitles(selectionSql, true);
        }
        const titleExpr = this.dialect!.jsonTitleFromExpr(selectionSql);
        if (this.dialect!.driver === DriverClient.Pg) {
          return `to_jsonb(${titleExpr})`;
        }
        if (this.dialect!.driver === DriverClient.Sqlite) {
          return `json(${titleExpr})`;
        }
        return titleExpr;
      }
      if (fieldInfo.isMultipleCellValue) {
        return this.dialect!.linkExtractTitles(selectionSql, true);
      }
      return this.dialect!.jsonTitleFromExpr(selectionSql);
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

      if (preferRaw && selectContext.targetDbFieldType === DbFieldType.Json) {
        if (fieldInfo.isMultipleCellValue) {
          return this.dialect!.linkExtractTitles(selectionSql, true);
        }
        // For single-value formulas targeting json columns, wrap scalar title as json
        const titleExpr = this.dialect!.jsonTitleFromExpr(selectionSql);
        if (this.dialect!.driver === DriverClient.Pg) {
          return `to_jsonb(${titleExpr})`;
        }
        if (this.dialect!.driver === DriverClient.Sqlite) {
          return `json(${titleExpr})`;
        }
        return titleExpr;
      }

      return this.dialect!.jsonTitleFromExpr(selectionSql);
    }

    if (selectionSql) {
      const normalizedSelection = this.normalizeLookupSelection(
        selectionSql,
        fieldInfo,
        selectContext
      );

      if (normalizedSelection !== selectionSql) {
        return normalizedSelection;
      }

      if (preferRaw) {
        return this.coerceRawMultiValueReference(selectionSql, fieldInfo, selectContext);
      }

      return selectionSql;
    }
    // Use table alias if provided in context
    if (selectContext.tableAlias) {
      const aliasExpr = `"${selectContext.tableAlias}"."${fieldInfo.dbFieldName}"`;
      return preferRaw
        ? this.coerceRawMultiValueReference(aliasExpr, fieldInfo, selectContext)
        : aliasExpr;
    }

    const fallbackExpr = this.formulaQuery.fieldReference(fieldId, fieldInfo.dbFieldName);
    return preferRaw
      ? this.coerceRawMultiValueReference(fallbackExpr, fieldInfo, selectContext)
      : fallbackExpr;
  }

  private normalizeLookupSelection(
    expr: string,
    fieldInfo: FieldCore,
    selectContext: ISelectFormulaConversionContext
  ): string {
    if (!expr) {
      return expr;
    }

    const dialect = this.dialect;
    if (!dialect) {
      return expr;
    }

    if (
      fieldInfo.type !== FieldType.Link ||
      !fieldInfo.isLookup ||
      !fieldInfo.lookupOptions ||
      !isLinkLookupOptions(fieldInfo.lookupOptions)
    ) {
      return expr;
    }

    const preferRaw = !!selectContext.preferRawFieldReferences;
    const targetDbType = selectContext.targetDbFieldType;
    if (preferRaw && targetDbType === DbFieldType.Json) {
      return expr;
    }

    const trimmed = expr.trim();
    if (!trimmed || trimmed.toUpperCase() === 'NULL') {
      return expr;
    }

    const titlesExpr = dialect.linkExtractTitles(expr, !!fieldInfo.isMultipleCellValue);
    if (fieldInfo.isMultipleCellValue) {
      return dialect.formatStringArray(titlesExpr, { fieldInfo });
    }
    return titlesExpr;
  }

  private coerceRawMultiValueReference(
    expr: string,
    fieldInfo: FieldCore,
    selectContext: ISelectFormulaConversionContext
  ): string {
    if (!expr) return expr;
    const trimmed = expr.trim().toUpperCase();
    if (trimmed === 'NULL') {
      return expr;
    }
    if (!fieldInfo.isMultipleCellValue) {
      return expr;
    }

    const targetType = selectContext.targetDbFieldType;
    if (!targetType || targetType === DbFieldType.Json) {
      return expr;
    }

    if (!this.dialect) {
      return expr;
    }

    // eslint-disable-next-line sonarjs/no-small-switch
    switch (this.dialect.driver) {
      case DriverClient.Pg: {
        if (targetType !== DbFieldType.DateTime) {
          return expr;
        }
        const safeJsonExpr = `(CASE
          WHEN pg_typeof(${expr}) = 'jsonb'::regtype THEN (${expr})::text::jsonb
          WHEN pg_typeof(${expr}) = 'json'::regtype THEN (${expr})::text::jsonb
          ELSE NULL::jsonb
        END)`;
        return `(SELECT elem #>> '{}'
          FROM jsonb_array_elements(COALESCE(${safeJsonExpr}, '[]'::jsonb)) AS elem
          WHERE jsonb_typeof(elem) NOT IN ('array','object')
          LIMIT 1
        )`;
      }
      default:
        return expr;
    }
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
        const rawName = parent.func_name().text.toUpperCase();
        const fnName = normalizeFunctionNameAlias(rawName) as FunctionName;
        if (BOOLEAN_FUNCTIONS.has(fnName)) {
          return true;
        }

        if (fnName === FunctionName.If) {
          const conditionExpr = parent.expr(0);
          return conditionExpr ? this.isAncestorNode(conditionExpr, ctx) : false;
        }

        return false;
      }

      // Also check for binary logical operators
      if (parent instanceof BinaryOpContext) {
        const operator = parent._op?.text;
        if (!operator) return false;
        // Only treat actual logical operators as boolean context; comparison operators
        // should preserve the original field value for proper type-aware comparisons.
        const logicalOperators = ['&&', '||'];
        return logicalOperators.includes(operator);
      }

      parent = parent.parent;
    }

    return false;
  }

  private isAncestorNode(ancestor: any, node: any): boolean {
    let current = node;
    while (current) {
      if (current === ancestor) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }
}
