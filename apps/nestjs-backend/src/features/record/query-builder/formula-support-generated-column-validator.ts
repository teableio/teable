import type {
  TableDomain,
  IFunctionCallInfo,
  ExprContext,
  FormulaFieldCore,
  UnaryOpContext,
  RuleNode,
} from '@teable/core';
import {
  parseFormula,
  FunctionCallCollectorVisitor,
  FieldReferenceVisitor,
  FieldType,
  AbstractParseTreeVisitor,
  CellValueType,
  FunctionName,
  LeftWhitespaceOrCommentsContext,
  normalizeFunctionNameAlias,
  RightWhitespaceOrCommentsContext,
  StringLiteralContext,
  IntegerLiteralContext,
  DecimalLiteralContext,
  BooleanLiteralContext,
  FunctionCallContext,
  FieldReferenceCurlyContext,
  BracketsContext,
  BinaryOpContext,
  DbFieldType,
} from '@teable/core';
import { match } from 'ts-pattern';
import type { IGeneratedColumnQuerySupportValidator } from './sql-conversion.visitor';

/**
 * Validates whether a formula expression is supported for generated column creation
 * by checking if all functions used in the formula are supported by the database provider.
 */
export class FormulaSupportGeneratedColumnValidator {
  constructor(
    private readonly supportValidator: IGeneratedColumnQuerySupportValidator,
    private readonly tableDomain: TableDomain
  ) {}

  /**
   * Validates whether a formula expression can be used to create a generated column
   * @param expression The formula expression to validate
   * @returns true if all functions in the formula are supported, false otherwise
   */
  validateFormula(expression: string): boolean {
    try {
      // Parse the formula expression into an AST
      const tree = parseFormula(expression);

      // First check if any referenced fields are link, lookup, or rollup fields
      if (!this.validateFieldReferences(tree)) {
        return false;
      }

      if (this.hasDatetimeStringConcatenation(tree)) {
        return false;
      }

      // Extract all function calls from the AST
      const collector = new FunctionCallCollectorVisitor();
      const functionCalls = collector.visit(tree);

      // Check if all functions are supported
      return (
        functionCalls.every((funcCall: IFunctionCallInfo) => {
          return this.isFunctionSupported(funcCall.name, funcCall.paramCount);
        }) && this.validateTypeSafety(tree)
      );
    } catch (error) {
      // If parsing fails, the formula is not valid for generated columns
      console.warn(`Failed to parse formula expression: ${expression}`, error);
      return false;
    }
  }

  /**
   * Validates that all field references in the formula are supported for generated columns
   * @param tree The parsed formula AST
   * @param visitedFields Set of field IDs already visited to prevent circular references
   * @returns true if all field references are supported, false otherwise
   */
  private validateFieldReferences(
    tree: ExprContext,
    visitedFields: Set<string> = new Set()
  ): boolean {
    // Extract field references from the formula
    const fieldReferenceVisitor = new FieldReferenceVisitor();
    const fieldIds = fieldReferenceVisitor.visit(tree);

    // Check each referenced field
    for (const fieldId of fieldIds) {
      if (!this.validateSingleFieldReference(fieldId, visitedFields)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validates a single field reference, including recursive validation for formula fields
   * @param fieldId The field ID to validate
   * @param visitedFields Set of field IDs already visited to prevent circular references
   * @returns true if the field reference is supported, false otherwise
   */
  private validateSingleFieldReference(fieldId: string, visitedFields: Set<string>): boolean {
    // Prevent circular references
    if (visitedFields.has(fieldId)) {
      return true; // Skip already visited fields to avoid infinite recursion
    }

    const field = this.tableDomain.getField(fieldId);
    if (!field) {
      // If field is not found, it's invalid for generated columns
      return false;
    }

    // Disallow referencing non-immutable or generated-backed fields
    // 1) Link / Lookup / Rollup (require joins/CTEs)
    // 2) System generated fields and user-by fields
    if (
      field.type === FieldType.Link ||
      field.type === FieldType.Rollup ||
      field.type === FieldType.ConditionalRollup ||
      field.isLookup === true ||
      field.type === FieldType.CreatedTime ||
      field.type === FieldType.LastModifiedTime ||
      field.type === FieldType.AutoNumber ||
      field.type === FieldType.CreatedBy ||
      field.type === FieldType.LastModifiedBy
    ) {
      return false;
    }

    // If it's a formula field, recursively check its dependencies
    if (field.type === FieldType.Formula) {
      visitedFields.add(fieldId);

      try {
        const expression = (field as FormulaFieldCore).getExpression();
        if (expression) {
          const tree = parseFormula(expression);
          return this.validateFieldReferences(tree, visitedFields);
        }
      } catch (error) {
        // If parsing the nested formula fails, consider it unsupported
        console.warn(`Failed to parse nested formula expression for field ${fieldId}:`, error);
        return false;
      } finally {
        visitedFields.delete(fieldId);
      }
    }

    return true;
  }

  /**
   * Checks if a specific function is supported for generated columns
   * @param functionName The function name (case-insensitive)
   * @param paramCount The number of parameters for the function
   * @returns true if the function is supported, false otherwise
   */
  private isFunctionSupported(funcName: string, paramCount: number): boolean {
    if (!funcName) {
      return false;
    }

    try {
      return (
        this.checkNumericFunctions(funcName, paramCount) ||
        this.checkTextFunctions(funcName, paramCount) ||
        this.checkDateTimeFunctions(funcName, paramCount) ||
        this.checkLogicalFunctions(funcName, paramCount) ||
        this.checkArrayFunctions(funcName, paramCount) ||
        this.checkSystemFunctions(funcName)
      );
    } catch (error) {
      console.warn(`Error checking support for function ${funcName}:`, error);
      return false;
    }
  }

  private checkNumericFunctions(funcName: string, paramCount: number): boolean {
    const dummyParam = 'dummy';
    const dummyParams = Array(paramCount).fill(dummyParam);

    return match(funcName)
      .with('SUM', () => this.supportValidator.sum(dummyParams))
      .with('AVERAGE', () => this.supportValidator.average(dummyParams))
      .with('MAX', () => this.supportValidator.max(dummyParams))
      .with('MIN', () => this.supportValidator.min(dummyParams))
      .with('ROUND', () =>
        this.supportValidator.round(dummyParam, paramCount > 1 ? dummyParam : undefined)
      )
      .with('ROUNDUP', () =>
        this.supportValidator.roundUp(dummyParam, paramCount > 1 ? dummyParam : undefined)
      )
      .with('ROUNDDOWN', () =>
        this.supportValidator.roundDown(dummyParam, paramCount > 1 ? dummyParam : undefined)
      )
      .with('CEILING', () => this.supportValidator.ceiling(dummyParam))
      .with('FLOOR', () => this.supportValidator.floor(dummyParam))
      .with('EVEN', () => this.supportValidator.even(dummyParam))
      .with('ODD', () => this.supportValidator.odd(dummyParam))
      .with('INT', () => this.supportValidator.int(dummyParam))
      .with('ABS', () => this.supportValidator.abs(dummyParam))
      .with('SQRT', () => this.supportValidator.sqrt(dummyParam))
      .with('POWER', () => this.supportValidator.power(dummyParam, dummyParam))
      .with('EXP', () => this.supportValidator.exp(dummyParam))
      .with('LOG', () =>
        this.supportValidator.log(dummyParam, paramCount > 1 ? dummyParam : undefined)
      )
      .with('MOD', () => this.supportValidator.mod(dummyParam, dummyParam))
      .with('VALUE', () => this.supportValidator.value(dummyParam))
      .otherwise(() => false);
  }

  private checkTextFunctions(funcName: string, paramCount: number): boolean {
    const dummyParam = 'dummy';
    const dummyParams = Array(paramCount).fill(dummyParam);

    return match(funcName)
      .with('CONCATENATE', () => this.supportValidator.concatenate(dummyParams))
      .with('FIND', () =>
        this.supportValidator.find(dummyParam, dummyParam, paramCount > 2 ? dummyParam : undefined)
      )
      .with('SEARCH', () =>
        this.supportValidator.search(
          dummyParam,
          dummyParam,
          paramCount > 2 ? dummyParam : undefined
        )
      )
      .with('MID', () => this.supportValidator.mid(dummyParam, dummyParam, dummyParam))
      .with('LEFT', () => this.supportValidator.left(dummyParam, dummyParam))
      .with('RIGHT', () => this.supportValidator.right(dummyParam, dummyParam))
      .with('REPLACE', () =>
        this.supportValidator.replace(dummyParam, dummyParam, dummyParam, dummyParam)
      )
      .with('REGEX_REPLACE', () =>
        this.supportValidator.regexpReplace(dummyParam, dummyParam, dummyParam)
      )
      .with('SUBSTITUTE', () =>
        this.supportValidator.substitute(
          dummyParam,
          dummyParam,
          dummyParam,
          paramCount > 3 ? dummyParam : undefined
        )
      )
      .with('LOWER', () => this.supportValidator.lower(dummyParam))
      .with('UPPER', () => this.supportValidator.upper(dummyParam))
      .with('REPT', () => this.supportValidator.rept(dummyParam, dummyParam))
      .with('TRIM', () => this.supportValidator.trim(dummyParam))
      .with('LEN', () => this.supportValidator.len(dummyParam))
      .with('T', () => this.supportValidator.t(dummyParam))
      .with('ENCODE_URL_COMPONENT', () => this.supportValidator.encodeUrlComponent(dummyParam))
      .otherwise(() => false);
  }

  private checkDateTimeFunctions(funcName: string, paramCount: number): boolean {
    const dummyParam = 'dummy';

    return match(funcName)
      .with('NOW', () => this.supportValidator.now())
      .with('TODAY', () => this.supportValidator.today())
      .with('DATE_ADD', () => this.supportValidator.dateAdd(dummyParam, dummyParam, dummyParam))
      .with('DATESTR', () => this.supportValidator.datestr(dummyParam))
      .with('DATETIME_DIFF', () =>
        this.supportValidator.datetimeDiff(dummyParam, dummyParam, dummyParam)
      )
      .with('DATETIME_FORMAT', () => this.supportValidator.datetimeFormat(dummyParam, dummyParam))
      .with('DATETIME_PARSE', () => this.supportValidator.datetimeParse(dummyParam, dummyParam))
      .with('DAY', () => this.supportValidator.day(dummyParam))
      .with('FROMNOW', () => this.supportValidator.fromNow(dummyParam))
      .with('HOUR', () => this.supportValidator.hour(dummyParam))
      .with('IS_AFTER', () => this.supportValidator.isAfter(dummyParam, dummyParam))
      .with('IS_BEFORE', () => this.supportValidator.isBefore(dummyParam, dummyParam))
      .with('IS_SAME', () =>
        this.supportValidator.isSame(
          dummyParam,
          dummyParam,
          paramCount > 2 ? dummyParam : undefined
        )
      )
      .with('LAST_MODIFIED_TIME', () => this.supportValidator.lastModifiedTime())
      .with('MINUTE', () => this.supportValidator.minute(dummyParam))
      .with('MONTH', () => this.supportValidator.month(dummyParam))
      .with('SECOND', () => this.supportValidator.second(dummyParam))
      .with('TIMESTR', () => this.supportValidator.timestr(dummyParam))
      .with('TONOW', () => this.supportValidator.toNow(dummyParam))
      .with('WEEKNUM', () => this.supportValidator.weekNum(dummyParam))
      .with('WEEKDAY', () => this.supportValidator.weekday(dummyParam))
      .with('WORKDAY', () => this.supportValidator.workday(dummyParam, dummyParam))
      .with('WORKDAY_DIFF', () => this.supportValidator.workdayDiff(dummyParam, dummyParam))
      .with('YEAR', () => this.supportValidator.year(dummyParam))
      .with('CREATED_TIME', () => this.supportValidator.createdTime())
      .otherwise(() => false);
  }

  private checkLogicalFunctions(funcName: string, paramCount: number): boolean {
    const dummyParam = 'dummy';
    const dummyParams = Array(paramCount).fill(dummyParam);

    return match(funcName)
      .with('IF', () => this.supportValidator.if(dummyParam, dummyParam, dummyParam))
      .with('AND', () => this.supportValidator.and(dummyParams))
      .with('OR', () => this.supportValidator.or(dummyParams))
      .with('NOT', () => this.supportValidator.not(dummyParam))
      .with('XOR', () => this.supportValidator.xor(dummyParams))
      .with('BLANK', () => this.supportValidator.blank())
      .with('ERROR', () => this.supportValidator.error(dummyParam))
      .with('ISERROR', () => this.supportValidator.isError(dummyParam))
      .with('SWITCH', () => this.supportValidator.switch(dummyParam, [], dummyParam))
      .otherwise(() => false);
  }

  private checkArrayFunctions(funcName: string, paramCount: number): boolean {
    const dummyParam = 'dummy';
    const dummyParams = Array(paramCount).fill(dummyParam);

    return match(funcName)
      .with('COUNT', () => this.supportValidator.count(dummyParams))
      .with('COUNTA', () => this.supportValidator.countA(dummyParams))
      .with('COUNTALL', () => this.supportValidator.countAll(dummyParam))
      .with('ARRAY_JOIN', () =>
        this.supportValidator.arrayJoin(dummyParam, paramCount > 1 ? dummyParam : undefined)
      )
      .with('ARRAY_UNIQUE', () => this.supportValidator.arrayUnique(dummyParam))
      .with('ARRAY_FLATTEN', () => this.supportValidator.arrayFlatten(dummyParam))
      .with('ARRAY_COMPACT', () => this.supportValidator.arrayCompact(dummyParam))
      .otherwise(() => false);
  }

  private checkSystemFunctions(funcName: string): boolean {
    const dummyParam = 'dummy';

    return match(funcName)
      .with('RECORD_ID', () => this.supportValidator.recordId())
      .with('AUTO_NUMBER', () => this.supportValidator.autoNumber())
      .with('TEXT_ALL', () => this.supportValidator.textAll(dummyParam))
      .otherwise(() => false);
  }

  /**
   * Perform a conservative type-safety validation over binary/unary operations.
   * Only blocks clearly invalid expressions (e.g., arithmetic with definite string literals
   * or text fields). If types are uncertain, it allows it to avoid false negatives.
   */
  private validateTypeSafety(tree: ExprContext): boolean {
    try {
      class TypeInferVisitor extends AbstractParseTreeVisitor<
        'string' | 'number' | 'boolean' | 'datetime' | 'unknown'
      > {
        constructor(private readonly tableDomain: TableDomain) {
          super();
        }

        protected defaultResult(): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
          return 'unknown';
        }

        visitStringLiteral(
          _ctx: StringLiteralContext
        ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
          return 'string';
        }

        visitIntegerLiteral(
          _ctx: IntegerLiteralContext
        ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
          return 'number';
        }

        visitDecimalLiteral(
          _ctx: DecimalLiteralContext
        ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
          return 'number';
        }

        visitBooleanLiteral(
          _ctx: BooleanLiteralContext
        ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
          return 'boolean';
        }

        visitBrackets(
          ctx: BracketsContext
        ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
          return ctx.expr().accept(this);
        }

        visitUnaryOp(
          ctx: UnaryOpContext
        ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
          const operandType = ctx.expr().accept(this);
          // Unary minus is numeric-only; if we can prove it's string, mark as unknown (invalid later)
          return operandType === 'string' ? 'unknown' : 'number';
        }

        visitFieldReferenceCurly(
          ctx: FieldReferenceCurlyContext
        ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
          const fieldId = ctx.text.slice(1, -1);
          const field = this.tableDomain.getField(fieldId);
          if (!field) return 'unknown';
          switch (field.cellValueType) {
            case CellValueType.String:
              return 'string';
            case CellValueType.Number:
              return 'number';
            case CellValueType.Boolean:
              return 'boolean';
            case CellValueType.DateTime:
              return 'datetime';
            case 'dateTime':
              return 'datetime';
            default:
              if (
                field.type === FieldType.Date ||
                field.type === FieldType.CreatedTime ||
                field.type === FieldType.LastModifiedTime
              ) {
                return 'datetime';
              }
              if (field.cellValueType === 'datetime') {
                return 'datetime';
              }
              if (field.dbFieldType === 'DATETIME') {
                return 'datetime';
              }
              return 'unknown';
          }
        }

        visitFunctionCall(
          _ctx: FunctionCallContext
        ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
          // We don't derive precise return types here; keep as unknown to avoid false negatives
          return 'unknown';
        }

        // eslint-disable-next-line sonarjs/cognitive-complexity
        visitBinaryOp(
          ctx: BinaryOpContext
        ): 'string' | 'number' | 'boolean' | 'datetime' | 'unknown' {
          const operator = ctx._op?.text ?? '';
          const leftType = ctx.expr(0).accept(this);
          const rightType = ctx.expr(1).accept(this);

          const arithmetic = ['-', '*', '/', '%'];
          const comparison = ['>', '<', '>=', '<=', '=', '!=', '<>'];
          const stringConcat = ['&'];

          if (operator === '+') {
            // Ambiguous in our grammar; be conservative: if either side is string, treat as string
            if (leftType === 'string' || rightType === 'string') return 'string';
            if (leftType === 'datetime' || rightType === 'datetime') return 'string';
            if (leftType === 'number' && rightType === 'number') return 'number';
            return 'unknown';
          }

          if (arithmetic.includes(operator)) {
            // Arithmetic requires numeric operands. If any side is definitively string -> invalid
            if (leftType === 'string' || rightType === 'string') return 'unknown';
            return 'number';
          }

          if (comparison.includes(operator)) {
            return 'boolean';
          }

          if (stringConcat.includes(operator)) {
            return 'string';
          }

          return 'unknown';
        }
      }

      class InvalidArithmeticDetector extends AbstractParseTreeVisitor<boolean> {
        constructor(private readonly infer: TypeInferVisitor) {
          super();
        }

        protected defaultResult(): boolean {
          return false;
        }

        visitChildren(node: RuleNode): boolean {
          const n = node.childCount;
          for (let i = 0; i < n; i++) {
            const child = node.getChild(i);
            if (child && child.accept(this)) {
              return true;
            }
          }
          return false;
        }

        visitBinaryOp(ctx: BinaryOpContext): boolean {
          const operator = ctx._op?.text ?? '';
          const arithmetic = ['-', '*', '/', '%'];
          const stringConcat = ['&'];
          const plusOperator = operator === '+';
          if (plusOperator || stringConcat.includes(operator)) {
            const leftType = ctx.expr(0).accept(this.infer);
            const rightType = ctx.expr(1).accept(this.infer);
            const behavesAsString =
              stringConcat.includes(operator) ||
              (plusOperator &&
                (leftType === 'string' ||
                  rightType === 'string' ||
                  leftType === 'datetime' ||
                  rightType === 'datetime'));
            if (behavesAsString && (leftType === 'datetime' || rightType === 'datetime')) {
              return true;
            }
          }
          if (arithmetic.includes(operator)) {
            const leftType = ctx.expr(0).accept(this.infer);
            const rightType = ctx.expr(1).accept(this.infer);
            // If we can prove any operand is a string, this arithmetic is unsafe
            if (leftType === 'string' || rightType === 'string') {
              return true;
            }
          }
          // Continue walking
          return this.visitChildren(ctx);
        }
      }

      const infer = new TypeInferVisitor(this.tableDomain);
      const detector = new InvalidArithmeticDetector(infer);
      // If detector finds invalid arithmetic, validation fails
      return !tree.accept(detector);
    } catch (e) {
      console.warn('Type-safety validation failed with error:', e);
      // On validator failure, be conservative and disable generated column support
      return false;
    }
  }

  private hasDatetimeStringConcatenation(tree: ExprContext): boolean {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    class DatetimeConcatDetector extends AbstractParseTreeVisitor<boolean> {
      protected defaultResult(): boolean {
        return false;
      }

      // eslint-disable-next-line sonarjs/no-identical-functions
      visitChildren(node: RuleNode): boolean {
        const n = node.childCount;
        for (let i = 0; i < n; i++) {
          const child = node.getChild(i);
          if (child && child.accept(this)) {
            return true;
          }
        }
        return false;
      }

      visitBinaryOp(ctx: BinaryOpContext): boolean {
        const operator = ctx._op?.text ?? '';
        if (operator === '+' || operator === '&') {
          const leftType = self.inferBasicType(ctx.expr(0));
          const rightType = self.inferBasicType(ctx.expr(1));
          const behavesAsString =
            operator === '&' || leftType === 'string' || rightType === 'string';
          if ((leftType === 'datetime' || rightType === 'datetime') && behavesAsString) {
            return true;
          }
        }
        return this.visitChildren(ctx);
      }
    }

    return tree.accept(new DatetimeConcatDetector()) ?? false;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private inferBasicType(
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
    if (ctx instanceof FieldReferenceCurlyContext) {
      const fieldId = ctx.text.slice(1, -1);
      const field = this.tableDomain.getField(fieldId);
      if (!field) {
        return 'unknown';
      }
      switch (field.cellValueType) {
        case CellValueType.String:
          return 'string';
        case CellValueType.Number:
          return 'number';
        case CellValueType.Boolean:
          return 'boolean';
        case CellValueType.DateTime:
          return 'datetime';
        default:
          if (
            field.type === FieldType.Date ||
            field.type === FieldType.CreatedTime ||
            field.type === FieldType.LastModifiedTime
          ) {
            return 'datetime';
          }
          if (field?.dbFieldType === DbFieldType.DateTime) {
            return 'datetime';
          }
          return 'unknown';
      }
    }
    if (ctx instanceof FunctionCallContext) {
      const rawName = ctx.func_name().text.toUpperCase();
      const fnName = normalizeFunctionNameAlias(rawName) as FunctionName;
      if (
        [
          FunctionName.Today,
          FunctionName.Now,
          FunctionName.DateAdd,
          FunctionName.CreatedTime,
          FunctionName.LastModifiedTime,
          FunctionName.DatetimeParse,
        ].includes(fnName)
      ) {
        return 'datetime';
      }
      if (fnName === FunctionName.Concatenate) {
        return 'string';
      }
      return 'unknown';
    }
    if (ctx instanceof BinaryOpContext) {
      const operator = ctx._op?.text ?? '';
      const leftType = this.inferBasicType(ctx.expr(0));
      const rightType = this.inferBasicType(ctx.expr(1));
      if (operator === '+' || operator === '&') {
        if (leftType === 'string' || rightType === 'string') {
          return 'string';
        }
        if (leftType === 'datetime' || rightType === 'datetime') {
          return 'string';
        }
        if (leftType === 'number' && rightType === 'number') {
          return 'number';
        }
        return 'unknown';
      }
      if (['-', '*', '/', '%'].includes(operator)) {
        return 'number';
      }
      if (['>', '<', '>=', '<=', '=', '!=', '<>', '&&', '||'].includes(operator)) {
        return 'boolean';
      }
      if (operator === '&') {
        return 'string';
      }
      return 'unknown';
    }
    if (ctx instanceof BracketsContext) {
      return this.inferBasicType(ctx.expr());
    }
    if (
      ctx instanceof LeftWhitespaceOrCommentsContext ||
      ctx instanceof RightWhitespaceOrCommentsContext
    ) {
      return this.inferBasicType(ctx.expr());
    }
    return 'unknown';
  }
}
