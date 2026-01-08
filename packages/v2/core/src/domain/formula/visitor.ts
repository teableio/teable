import type {
  BinaryOpContext,
  BooleanLiteralContext,
  BracketsContext,
  DecimalLiteralContext,
  FieldReferenceCurlyContext,
  FunctionCallContext,
  IntegerLiteralContext,
  LeftWhitespaceOrCommentsContext,
  RightWhitespaceOrCommentsContext,
  RootContext,
  StringLiteralContext,
  UnaryOpContext,
  FormulaVisitor,
} from '@teable/formula';
import { extractFieldReferenceId, AbstractParseTreeVisitor } from '@teable/formula';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../shared/DomainError';
import { CellValueType } from './CellValueType';
import type { FormulaFieldReference } from './FormulaFieldReference';
import { normalizeFunctionNameAlias } from './function-aliases';
import { FunctionName } from './functions/common';
import { FUNCTIONS } from './functions/factory';
import { TypedValue } from './typed-value';
import { TypedValueConverter } from './typed-value-converter';

export class FormulaTypeVisitor
  extends AbstractParseTreeVisitor<Result<TypedValue, DomainError>>
  implements FormulaVisitor<Result<TypedValue, DomainError>>
{
  private readonly converter = new TypedValueConverter();

  constructor(private readonly dependencies: Readonly<Record<string, FormulaFieldReference>>) {
    super();
  }

  protected defaultResult(): Result<TypedValue, DomainError> {
    return ok(new TypedValue(null, CellValueType.String));
  }

  visitRoot(ctx: RootContext): Result<TypedValue, DomainError> {
    return ctx.expr().accept(this);
  }

  visitStringLiteral(_ctx: StringLiteralContext): Result<TypedValue, DomainError> {
    return ok(new TypedValue(null, CellValueType.String));
  }

  visitIntegerLiteral(_ctx: IntegerLiteralContext): Result<TypedValue, DomainError> {
    return ok(new TypedValue(null, CellValueType.Number));
  }

  visitDecimalLiteral(_ctx: DecimalLiteralContext): Result<TypedValue, DomainError> {
    return ok(new TypedValue(null, CellValueType.Number));
  }

  visitBooleanLiteral(_ctx: BooleanLiteralContext): Result<TypedValue, DomainError> {
    return ok(new TypedValue(null, CellValueType.Boolean));
  }

  visitLeftWhitespaceOrComments(
    ctx: LeftWhitespaceOrCommentsContext
  ): Result<TypedValue, DomainError> {
    return ctx.expr().accept(this);
  }

  visitRightWhitespaceOrComments(
    ctx: RightWhitespaceOrCommentsContext
  ): Result<TypedValue, DomainError> {
    return ctx.expr().accept(this);
  }

  visitBrackets(ctx: BracketsContext): Result<TypedValue, DomainError> {
    return ctx.expr().accept(this);
  }

  visitUnaryOp(ctx: UnaryOpContext): Result<TypedValue, DomainError> {
    const exprResult = ctx.expr().accept(this);
    if (exprResult.isErr()) return err(exprResult.error);
    return ok(new TypedValue(null, CellValueType.Number, exprResult.value.isMultiple ?? false));
  }

  visitBinaryOp(ctx: BinaryOpContext): Result<TypedValue, DomainError> {
    const leftResult = ctx.expr(0).accept(this);
    if (leftResult.isErr()) return err(leftResult.error);
    const rightResult = ctx.expr(1).accept(this);
    if (rightResult.isErr()) return err(rightResult.error);

    const valueType = this.getBinaryOpValueType(ctx, leftResult.value, rightResult.value);
    // Comparison operators always return a single boolean value,
    // even when comparing arrays (the array is unwrapped to its first element in SQL).
    // Logical operators (||, &&) also return single boolean.
    const isComparisonOrLogical = this.isComparisonOrLogicalOp(ctx);
    const isMultiple = isComparisonOrLogical
      ? false
      : Boolean(leftResult.value.isMultiple || rightResult.value.isMultiple);
    return ok(new TypedValue(null, valueType, isMultiple));
  }

  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext): Result<TypedValue, DomainError> {
    const fieldId = extractFieldReferenceId(ctx);
    if (!fieldId) {
      return err(domainError.validation({ message: 'FieldId {} is a invalid field id' }));
    }

    const field = this.dependencies[fieldId];
    if (!field) {
      return err(domainError.validation({ message: `FieldId ${fieldId} is a invalid field id` }));
    }
    return ok(new TypedValue(null, field.cellValueType, field.isMultipleCellValue, field));
  }

  visitFunctionCall(ctx: FunctionCallContext): Result<TypedValue, DomainError> {
    const rawName = ctx.func_name().text.toUpperCase();
    const normalized = normalizeFunctionNameAlias(rawName) as FunctionName;
    const func = FUNCTIONS[normalized];
    if (!func) {
      return err(domainError.validation({ message: `Function name ${rawName} is not found` }));
    }

    if (normalized === FunctionName.Blank) {
      return ok(new TypedValue(null, CellValueType.String, false, undefined, true));
    }

    const params: TypedValue[] = [];
    for (const exprCtx of ctx.expr()) {
      const paramResult = exprCtx.accept(this);
      if (paramResult.isErr()) {
        if (normalized === FunctionName.IsError) {
          params.push(new TypedValue(null, CellValueType.String));
          continue;
        }
        return err(paramResult.error);
      }

      const convertedResult = this.converter.convertTypedValue(paramResult.value, func);
      if (convertedResult.isErr()) return err(convertedResult.error);
      params.push(convertedResult.value);
    }

    const returnResult = func.getReturnType(params);
    if (returnResult.isErr()) return err(returnResult.error);

    return ok(new TypedValue(null, returnResult.value.type, returnResult.value.isMultiple));
  }

  private isComparisonOrLogicalOp(ctx: BinaryOpContext): boolean {
    return Boolean(
      ctx.PIPE_PIPE() ||
        ctx.AMP_AMP() ||
        ctx.EQUAL() ||
        ctx.BANG_EQUAL() ||
        ctx.GT() ||
        ctx.GTE() ||
        ctx.LT() ||
        ctx.LTE()
    );
  }

  private getBinaryOpValueType(
    ctx: BinaryOpContext,
    left: TypedValue,
    right: TypedValue
  ): CellValueType {
    switch (true) {
      case Boolean(ctx.PLUS()): {
        if (left.type === CellValueType.Number && right.type === CellValueType.Number) {
          return CellValueType.Number;
        }
        return CellValueType.String;
      }
      case Boolean(ctx.MINUS()):
      case Boolean(ctx.STAR()):
      case Boolean(ctx.PERCENT()):
      case Boolean(ctx.SLASH()): {
        return CellValueType.Number;
      }
      case Boolean(ctx.PIPE_PIPE()):
      case Boolean(ctx.AMP_AMP()):
      case Boolean(ctx.EQUAL()):
      case Boolean(ctx.BANG_EQUAL()):
      case Boolean(ctx.GT()):
      case Boolean(ctx.GTE()):
      case Boolean(ctx.LT()):
      case Boolean(ctx.LTE()): {
        return CellValueType.Boolean;
      }
      case Boolean(ctx.AMP()): {
        return CellValueType.String;
      }
      default: {
        return CellValueType.String;
      }
    }
  }
}
