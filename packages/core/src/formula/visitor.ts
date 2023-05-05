/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import type { FieldCore, IRecord } from '../models';
import { CellValueType } from '../models';
import type { FormulaFunc, FunctionName } from './functions/common';
import { FUNCTIONS } from './functions/factory';
import type {
  BinaryOpContext,
  BooleanLiteralContext,
  BracketsContext,
  DecimalLiteralContext,
  ExprContext,
  FunctionCallContext,
  IntegerLiteralContext,
  LeftWhitespaceOrCommentsContext,
  LookupFieldReferenceContext,
  RightWhitespaceOrCommentsContext,
  RootContext,
  StringLiteralContext,
} from './parser/Formula';
import { FieldReferenceContext } from './parser/Formula';
import type { FormulaVisitor } from './parser/FormulaVisitor';
import type { ITypedValue } from './typed-value';
import { ArrayTypedValue, FlatTypedValue } from './typed-value';

export class EvalVisitor
  extends AbstractParseTreeVisitor<ITypedValue>
  implements FormulaVisitor<ITypedValue>
{
  constructor(private dependencies: { [fieldId: string]: FieldCore }, private record?: IRecord) {
    super();
  }

  visitRoot(ctx: RootContext) {
    return ctx.expr().accept(this);
  }

  visitStringLiteral(ctx: StringLiteralContext): any {
    // Extract and return the string value without quotes
    const value = ctx.text.slice(1, -1);
    return new FlatTypedValue(value, CellValueType.String);
  }

  visitIntegerLiteral(ctx: IntegerLiteralContext): any {
    // Parse and return the integer value
    const value = parseInt(ctx.text, 10);
    return new FlatTypedValue(value, CellValueType.Number);
  }

  visitDecimalLiteral(ctx: DecimalLiteralContext): any {
    // Parse and return the decimal value
    const value = parseFloat(ctx.text);
    return new FlatTypedValue(value, CellValueType.Number);
  }

  visitBooleanLiteral(ctx: BooleanLiteralContext): any {
    // Parse and return the boolean value
    const value = ctx.text.toUpperCase() === 'TRUE';
    return new FlatTypedValue(value, CellValueType.Boolean);
  }

  visitLeftWhitespaceOrComments(ctx: LeftWhitespaceOrCommentsContext): any {
    return this.visit(ctx.expr());
  }

  visitRightWhitespaceOrComments(ctx: RightWhitespaceOrCommentsContext): any {
    return this.visit(ctx.expr());
  }

  visitBrackets(ctx: BracketsContext): any {
    return this.visit(ctx.expr());
  }

  private getBinaryOpValueType(
    ctx: BinaryOpContext,
    left: ITypedValue,
    right: ITypedValue
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
        throw new TypeError(`unknown operator: ${ctx.text}`);
      }
    }
  }

  private getFieldFromCtx(ctx: FieldReferenceContext): FieldCore {
    const fieldId = ctx.field_reference().text.slice(1, -1);
    const field = this.dependencies[fieldId];
    if (!field) {
      throw new Error(`FieldId ${fieldId} is not found from dependencies`);
    }

    return field;
  }

  private transformNodeValue(node: ExprContext, ctx: BinaryOpContext, value: any) {
    // A Node with a field value type requires dedicated string conversion logic to be executed.
    if (
      !node.children ||
      !node.children[0] ||
      !(node.children[0] instanceof FieldReferenceContext)
    ) {
      return value;
    }

    const fieldCtx = node.children[0];
    const field = this.getFieldFromCtx(fieldCtx);
    const isComparisonOperator = [
      ctx.EQUAL(),
      ctx.BANG_EQUAL(),
      ctx.LT(),
      ctx.LTE(),
      ctx.GT(),
      ctx.GTE(),
    ].some((op) => Boolean(op));

    if (field.cellValueType === CellValueType.DateTime && isComparisonOperator) {
      return value;
    }

    if (
      [CellValueType.Number, CellValueType.Boolean, CellValueType.String].includes(
        field.cellValueType
      )
    ) {
      return value;
    }

    if (
      field.cellValueType === CellValueType.Array &&
      field.cellValueElementType === CellValueType.Number
    ) {
      if (!value?.length) return null;
      if (value.length > 1) {
        throw new TypeError(
          'Cannot perform mathematical calculations on an array with more than one numeric element.'
        );
      }
      return Number(value[0]);
    }

    return field.cellValue2String(value);
  }

  visitBinaryOp(ctx: BinaryOpContext) {
    const leftNode = ctx.expr(0);
    const rightNode = ctx.expr(1);
    const left = this.visit(leftNode)!;
    const right = this.visit(rightNode)!;
    const lv = this.transformNodeValue(leftNode, ctx, left.value);
    const rv = this.transformNodeValue(rightNode, ctx, right.value);

    const valueType = this.getBinaryOpValueType(ctx, left, right);
    let value: any;
    switch (true) {
      case Boolean(ctx.STAR()): {
        value = lv * rv;
        break;
      }
      case Boolean(ctx.SLASH()): {
        value = lv / rv;
        break;
      }
      case Boolean(ctx.PLUS()): {
        value = lv + rv;
        break;
      }
      case Boolean(ctx.PERCENT()): {
        value = lv % rv;
        break;
      }
      case Boolean(ctx.MINUS()): {
        value = lv - rv;
        break;
      }
      case Boolean(ctx.GT()): {
        value = lv > rv;
        break;
      }
      case Boolean(ctx.LT()): {
        value = lv < rv;
        break;
      }
      case Boolean(ctx.GTE()): {
        value = lv >= rv;
        break;
      }
      case Boolean(ctx.LTE()): {
        value = lv <= rv;
        break;
      }
      case Boolean(ctx.EQUAL()): {
        value = lv == rv;
        break;
      }
      case Boolean(ctx.BANG_EQUAL()): {
        value = lv != rv;
        break;
      }
      case Boolean(ctx.AMP()): {
        value = String(lv == null ? '' : lv) + String(rv == null ? '' : rv);
        break;
      }
      case Boolean(ctx.AMP_AMP()): {
        value = lv && rv;
        break;
      }
      case Boolean(ctx.PIPE_PIPE()): {
        value = lv || rv;
        break;
      }
      default:
        throw new Error(`Unsupported binary operation: ${ctx.text}`);
    }
    return new FlatTypedValue(value, valueType);
  }

  visitFieldReference(ctx: FieldReferenceContext) {
    const field = this.getFieldFromCtx(ctx);
    const value = this.record ? this.record.fields[field.id] : null;

    console.log('visitFieldReference:value:', value);

    if (field.cellValueType === CellValueType.Array) {
      if (!field.cellValueElementType) {
        throw new Error('field.cellValueElementType is not define for a array value');
      }
      return new ArrayTypedValue(value, field.cellValueElementType, field);
    }
    return new FlatTypedValue(value, field.cellValueType, field);
  }

  visitLookupFieldReference(ctx: LookupFieldReferenceContext): any {
    console.log('visitLookupFieldReference', ctx.text);
    console.log(
      'visitLookupFieldReferenceFieldName',
      ctx
        .field_reference()
        .map((x) => x.text)
        .join()
    );
    // Here you would implement lookup field reference logic based on your specific data model
  }

  private transformTypedValue(typedValue: ITypedValue, func: FormulaFunc): ITypedValue {
    const { value, type, field } = typedValue;

    if (
      type === CellValueType.Array &&
      !func.acceptCellValueType.has(CellValueType.Array) &&
      'elementType' in typedValue &&
      typedValue.elementType === CellValueType.Number
    ) {
      if (value?.length > 1) {
        throw new TypeError(`function ${func.name} is not accept array value: ${value}`);
      }
      const transValue = value && value[0];
      return new FlatTypedValue(transValue, CellValueType.Number);
    }

    if (!func.acceptCellValueType.has(type)) {
      const transValue = field ? field.cellValue2String(value) : String(value);
      return new FlatTypedValue(transValue, CellValueType.String);
    }

    if (!func.acceptCellValueType.has(type) && type === CellValueType.DateTime) {
      const transValue = value == null ? value : new Date(value).toISOString();
      return new FlatTypedValue(transValue, CellValueType.DateTime);
    }

    return typedValue;
  }

  visitFunctionCall(ctx: FunctionCallContext) {
    console.log('visitFunctionCall', ctx.func_name().text);
    const fnName = ctx.func_name().text.toUpperCase() as FunctionName;
    const func = FUNCTIONS[fnName];
    if (!func) {
      throw new TypeError(`Function name ${func} is not found`);
    }

    const params = ctx.expr().map((exprCtx) => {
      const typedValue = this.visit(exprCtx);
      return this.transformTypedValue(typedValue, func);
    });

    const { type, elementType } = func.getReturnType(params);

    if (!this.record) {
      return new FlatTypedValue(null, type);
    }

    const value = func.eval(params, { record: this.record, dependencies: this.dependencies });
    if (type === CellValueType.Array && elementType) {
      return new ArrayTypedValue(value, elementType);
    }
    return new FlatTypedValue(value, type);
  }

  protected defaultResult() {
    return new FlatTypedValue(null, CellValueType.String);
  }
}
