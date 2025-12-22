import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import type {
  BinaryOpContext,
  BracketsContext,
  FunctionCallContext,
  UnaryOpContext,
  LeftWhitespaceOrCommentsContext,
  RightWhitespaceOrCommentsContext,
} from './parser/Formula';
import type { FormulaVisitor } from './parser/FormulaVisitor';

/**
 * Information about a function call found in the formula
 */
export interface IFunctionCallInfo {
  /** Function name in uppercase */
  name: string;
  /** Number of parameters */
  paramCount: number;
}

/**
 * Visitor that collects all function calls from a formula AST
 * This is used to analyze which functions are used in a formula expression.
 */
export class FunctionCallCollectorVisitor
  extends AbstractParseTreeVisitor<IFunctionCallInfo[]>
  implements FormulaVisitor<IFunctionCallInfo[]>
{
  defaultResult(): IFunctionCallInfo[] {
    return [];
  }

  aggregateResult(
    aggregate: IFunctionCallInfo[],
    nextResult: IFunctionCallInfo[]
  ): IFunctionCallInfo[] {
    return aggregate.concat(nextResult);
  }

  visitBinaryOp(ctx: BinaryOpContext): IFunctionCallInfo[] {
    // Visit both operands to find nested function calls
    const leftResult = this.visit(ctx.expr(0));
    const rightResult = this.visit(ctx.expr(1));
    return this.aggregateResult(leftResult, rightResult);
  }

  visitUnaryOp(ctx: UnaryOpContext): IFunctionCallInfo[] {
    // Visit the operand to find nested function calls
    return this.visit(ctx.expr());
  }

  visitBrackets(ctx: BracketsContext): IFunctionCallInfo[] {
    // Visit the expression inside brackets
    return this.visit(ctx.expr());
  }

  visitFunctionCall(ctx: FunctionCallContext): IFunctionCallInfo[] {
    // Extract function name and parameter count
    const functionName = ctx.func_name().text.toUpperCase();
    const paramCount = ctx.expr().length;

    // Create function call info for this function
    const currentFunction: IFunctionCallInfo = {
      name: functionName,
      paramCount,
    };

    // Visit all parameters to find nested function calls
    const nestedFunctions: IFunctionCallInfo[] = [];
    ctx.expr().forEach((paramCtx) => {
      const paramResult = this.visit(paramCtx);
      nestedFunctions.push(...paramResult);
    });

    // Return current function plus all nested functions
    return [currentFunction, ...nestedFunctions];
  }

  visitLeftWhitespaceOrComments(ctx: LeftWhitespaceOrCommentsContext): IFunctionCallInfo[] {
    // Visit the nested expression
    return this.visit(ctx.expr());
  }

  visitRightWhitespaceOrComments(ctx: RightWhitespaceOrCommentsContext): IFunctionCallInfo[] {
    // Visit the nested expression
    return this.visit(ctx.expr());
  }
}
