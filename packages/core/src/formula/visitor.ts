/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import { CellValueType } from '../models/field/constant';
import type { FieldCore } from '../models/field/field';
import type { IRecord } from '../models/record';
import { FunctionName } from './functions/common';
import type { FormulaFunc } from './functions/common';
import { FUNCTIONS } from './functions/factory';
import { FormulaBaseError } from './functions/logical';
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
import { TypedValue } from './typed-value';
import { TypedValueConverter } from './typed-value-converter';

const formulaBaseError = new TypedValue(new FormulaBaseError(), CellValueType.String, false);

export class EvalVisitor
  extends AbstractParseTreeVisitor<TypedValue>
  implements FormulaVisitor<TypedValue>
{
  private readonly converter = new TypedValueConverter();
  constructor(
    private dependencies: { [fieldId: string]: FieldCore },
    private record?: IRecord,
    private timeZone = 'UTC'
  ) {
    super();
  }

  visitRoot(ctx: RootContext) {
    return ctx.expr().accept(this);
  }

  visitStringLiteral(ctx: StringLiteralContext): any {
    // Extract and return the string value without quotes
    const quotedString = ctx.text;
    const rawString = quotedString.slice(1, -1);
    // Handle escape characters
    const unescapedString = this.unescapeString(rawString);
    return new TypedValue(unescapedString, CellValueType.String);
  }

  private unescapeString(str: string): string {
    return str.replace(/\\(.)/g, (_, char) => {
      switch (char) {
        case 'n':
          return '\n';
        case 'r':
          return '\r';
        case 't':
          return '\t';
        case 'b':
          return '\b';
        case 'f':
          return '\f';
        case 'v':
          return '\v';
        case '\\':
          return '\\';
        case '"':
          return '"';
        case "'":
          return "'";
        default:
          return '\\' + char;
      }
    });
  }

  visitIntegerLiteral(ctx: IntegerLiteralContext): any {
    // Parse and return the integer value
    const value = parseInt(ctx.text, 10);
    return new TypedValue(value, CellValueType.Number);
  }

  visitDecimalLiteral(ctx: DecimalLiteralContext): any {
    // Parse and return the decimal value
    const value = parseFloat(ctx.text);
    return new TypedValue(value, CellValueType.Number);
  }

  visitBooleanLiteral(ctx: BooleanLiteralContext): any {
    // Parse and return the boolean value
    const value = ctx.text.toUpperCase() === 'TRUE';
    return new TypedValue(value, CellValueType.Boolean);
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
        throw new TypeError(`unknown operator: ${ctx.text}`);
      }
    }
  }

  private transformNodeValue(typedValue: TypedValue, ctx: BinaryOpContext) {
    // A Node with a field value type requires dedicated string conversion logic to be executed.
    if (!typedValue.field) {
      return typedValue;
    }

    const field = typedValue.field;
    const isComparisonOperator = [
      ctx.EQUAL(),
      ctx.BANG_EQUAL(),
      ctx.LT(),
      ctx.LTE(),
      ctx.GT(),
      ctx.GTE(),
    ].some((op) => Boolean(op));

    if (field.cellValueType === CellValueType.DateTime && isComparisonOperator) {
      return typedValue;
    }

    if (field.isMultipleCellValue && field.cellValueType === CellValueType.Number) {
      if (!typedValue.value?.length) return null;
      if (typedValue.value.length > 1) {
        throw new TypeError(
          'Cannot perform mathematical calculations on an array with more than one numeric element.'
        );
      }
      return new TypedValue(Number(typedValue.value[0]), CellValueType.Number);
    }

    if (
      [CellValueType.Number, CellValueType.Boolean, CellValueType.String].includes(
        field.cellValueType
      )
    ) {
      return typedValue;
    }

    return new TypedValue(field.cellValue2String(typedValue.value), CellValueType.String);
  }

  private transformUnaryNodeValue(typedValue: TypedValue) {
    if (!typedValue.field) {
      return typedValue;
    }

    const { cellValueType, isMultipleCellValue } = typedValue.field;

    if (cellValueType !== CellValueType.Number) return null;

    if (isMultipleCellValue) {
      if (!typedValue.value?.length) return null;
      if (typedValue.value.length > 1) {
        throw new TypeError(
          'Cannot perform mathematical calculations on an array with more than one numeric element.'
        );
      }
      return new TypedValue(Number(typedValue.value[0]), CellValueType.Number);
    }
    return typedValue;
  }

  visitUnaryOp(ctx: UnaryOpContext) {
    const expr = ctx.expr();
    const typedValue = this.visit(expr);
    const value = this.transformUnaryNodeValue(typedValue)?.value ?? null;
    return new TypedValue(value ? -value : null, CellValueType.Number);
  }

  visitBinaryOp(ctx: BinaryOpContext) {
    const leftNode = ctx.expr(0);
    const rightNode = ctx.expr(1);
    const left = this.visit(leftNode)!;
    const right = this.visit(rightNode)!;
    const lv = this.transformNodeValue(left, ctx)?.value ?? null;
    const rv = this.transformNodeValue(right, ctx)?.value ?? null;

    const valueType = this.getBinaryOpValueType(ctx, left, right);
    let value: any;
    switch (true) {
      case Boolean(ctx.STAR()): {
        value = lv * rv;
        break;
      }
      case Boolean(ctx.SLASH()): {
        value = !rv ? null : lv / rv;
        break;
      }
      case Boolean(ctx.PLUS()): {
        value = lv + rv;
        break;
      }
      case Boolean(ctx.PERCENT()): {
        value = !rv ? null : lv % rv;
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
    return new TypedValue(value, valueType);
  }

  private createTypedValueByField(field: FieldCore) {
    let value: any = this.record ? this.record.fields[field.id] : null;

    if (
      value == null ||
      ![CellValueType.String, CellValueType.DateTime].includes(field.cellValueType)
    ) {
      return new TypedValue(value, field.cellValueType, field.isMultipleCellValue, field);
    }

    // some field like link or attachment may contain json object cellValue, that need to be converted to string.
    if (field.isMultipleCellValue && value[0] && typeof value[0] === 'object') {
      value = value.map((v: object) => (field.item2String ? field.item2String(v) : v));
    }

    if (!field.isMultipleCellValue && typeof value === 'object') {
      value = field.cellValue2String(value);
    }
    return new TypedValue(value, field.cellValueType, field.isMultipleCellValue, field);
  }

  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext) {
    const fieldId = ctx.field_reference_curly().text;
    if (fieldId == '') {
      return new TypedValue('', CellValueType.String);
    }

    const field = this.dependencies[fieldId.slice(1, -1)];
    if (!field) {
      throw new Error(`FieldId ${fieldId} is a invalid field id`);
    }
    return this.createTypedValueByField(field);
  }

  /**
   * transform typed value into function accept value type as possible as it can
   */
  private transformTypedValue(typedValue: TypedValue, func: FormulaFunc): TypedValue {
    return this.converter.convertTypedValue(typedValue, func);
  }

  visitFunctionCall(ctx: FunctionCallContext) {
    const fnName = ctx.func_name().text.toUpperCase() as FunctionName;
    const func = FUNCTIONS[fnName];
    if (!func) {
      throw new TypeError(`Function name ${func} is not found`);
    }

    if (fnName === FunctionName.Blank) {
      return new TypedValue(null, CellValueType.String, false, undefined, true);
    }

    let params;

    try {
      params = ctx.expr().map((exprCtx) => {
        const typedValue = this.visit(exprCtx);
        return this.transformTypedValue(typedValue, func);
      });
    } catch (e) {
      if (fnName !== FunctionName.IsError) throw e;
      params = [formulaBaseError];
    }

    const { type, isMultiple } = func.getReturnType(params as TypedValue<any>[]);

    if (!this.record) {
      return new TypedValue(null, type, isMultiple);
    }

    const value = func.eval(params as TypedValue<any>[], {
      record: this.record,
      dependencies: this.dependencies,
      timeZone: this.timeZone,
    });
    return new TypedValue(value, type, isMultiple);
  }

  protected defaultResult() {
    return new TypedValue(null, CellValueType.String);
  }
}
