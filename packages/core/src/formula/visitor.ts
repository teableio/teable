/* eslint-disable @typescript-eslint/no-explicit-any */
import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import type {
  BinaryOpContext,
  BooleanLiteralContext,
  BracketsContext,
  DecimalLiteralContext,
  FieldReferenceContext,
  FunctionCallContext,
  IntegerLiteralContext,
  LeftWhitespaceOrCommentsContext,
  LookupFieldReferenceContext,
  RightWhitespaceOrCommentsContext,
  RootContext,
  StringLiteralContext,
} from './parser/Formula';
import type { FormulaVisitor } from './parser/FormulaVisitor';

class EvalVisitor extends AbstractParseTreeVisitor<any> implements FormulaVisitor<any> {
  // Implement visit methods for each rule
  visitRoot(ctx: RootContext) {
    return ctx.expr().accept(this);
  }

  visitStringLiteral(ctx: StringLiteralContext): any {
    // Extract and return the string value without quotes
    return ctx.text.slice(1, -1);
  }

  visitIntegerLiteral(ctx: IntegerLiteralContext): any {
    // Parse and return the integer value
    return parseInt(ctx.text, 10);
  }

  visitDecimalLiteral(ctx: DecimalLiteralContext): any {
    // Parse and return the decimal value
    return parseFloat(ctx.text);
  }

  visitBooleanLiteral(ctx: BooleanLiteralContext): any {
    // Parse and return the boolean value
    return ctx.text === 'TRUE';
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

  visitBinaryOp(ctx: BinaryOpContext): any {
    const left = this.visit(ctx.expr(0));
    const right = this.visit(ctx.expr(1));

    if (ctx.STAR()) return left * right;
    if (ctx.SLASH()) return left / right;
    if (ctx.PLUS()) return left + right;
    if (ctx.MINUS()) return left - right;
    if (ctx.GT()) return left > right;
    if (ctx.LT()) return left < right;
    if (ctx.GTE()) return left >= right;
    if (ctx.LTE()) return left <= right;
    if (ctx.EQUAL()) return left == right;
    if (ctx.BANG_EQUAL()) return left != right;
    throw new Error(`Unsupported binary operation: ${ctx.text}`);
  }

  visitFieldReference(ctx: FieldReferenceContext): any {
    // Here you would implement field reference logic based on your specific data model
  }

  visitLookupFieldReference(ctx: LookupFieldReferenceContext): any {
    // Here you would implement lookup field reference logic based on your specific data model
  }

  visitFunctionCall(ctx: FunctionCallContext): any {
    // Here you would implement function call logic based on your specific functions available
  }

  protected defaultResult(): any {
    return null;
  }
}

export { EvalVisitor };
