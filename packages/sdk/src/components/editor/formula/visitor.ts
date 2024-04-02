import { FunctionCallContext } from '@teable/core';
import type {
  ExprContext,
  IntegerLiteralContext,
  LeftWhitespaceOrCommentsContext,
  RightWhitespaceOrCommentsContext,
  StringLiteralContext,
  FormulaVisitor,
} from '@teable/core';
import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import type { ParseTree } from 'antlr4ts/tree/ParseTree';
import type { TerminalNode } from 'antlr4ts/tree/TerminalNode';

export class FormulaNodePathVisitor
  extends AbstractParseTreeVisitor<void>
  implements FormulaVisitor<void>
{
  private pathNodes: ParseTree[] = [];
  private targetPosition: number;

  constructor(position: number) {
    super();
    this.targetPosition = position;
  }

  protected defaultResult() {
    return undefined;
  }

  private isPositionWithinRange(start: number, stop: number) {
    return start <= this.targetPosition && stop >= this.targetPosition;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public visitIfPositionInRange(ctx: any) {
    if (!ctx.start || !ctx.stop) return;

    const start = ctx.start.startIndex;
    const stop = ctx.stop.stopIndex;

    if (this.isPositionWithinRange(start, stop)) {
      this.pathNodes.push(ctx);
      this.visitChildren(ctx);
    }
  }

  public visitTerminal(node: TerminalNode) {
    const start = node.symbol.startIndex;
    const stop = node.symbol.stopIndex;

    if (this.isPositionWithinRange(start, stop)) {
      this.pathNodes.push(node);
    }
  }

  public visitLeftWhitespaceOrComments(ctx: LeftWhitespaceOrCommentsContext) {
    this.visitIfPositionInRange(ctx);
  }

  public visitRightWhitespaceOrComments(ctx: RightWhitespaceOrCommentsContext) {
    this.visitIfPositionInRange(ctx);
  }

  public visitIntegerLiteral(ctx: IntegerLiteralContext) {
    this.visitIfPositionInRange(ctx);
  }

  public visitStringLiteral(ctx: StringLiteralContext) {
    this.visitIfPositionInRange(ctx);
  }

  public visitFunctionCall(ctx: FunctionCallContext) {
    this.visitIfPositionInRange(ctx);
  }

  public getPathNodes() {
    return this.pathNodes;
  }

  public getNearestFunctionNode() {
    for (let i = this.pathNodes.length - 1; i >= 0; i--) {
      const node = this.pathNodes[i];
      if (node instanceof FunctionCallContext) {
        return node;
      }
    }
    return null;
  }

  public getNearestFunctionNodeIndex() {
    for (let i = this.pathNodes.length - 1; i >= 0; i--) {
      const node = this.pathNodes[i];
      if (node instanceof FunctionCallContext) {
        return i;
      }
    }
    return -1;
  }

  public getParamsIndex() {
    const pathSize = this.pathNodes.length;
    const nearestFuncIndex = this.getNearestFunctionNodeIndex();
    if (nearestFuncIndex > -1 && pathSize) {
      const funcNode = this.pathNodes[nearestFuncIndex] as FunctionCallContext;
      const childNode = this.pathNodes[nearestFuncIndex + 1];
      if (funcNode.CLOSE_PAREN() === childNode) {
        return Math.max(funcNode.expr().length - 1, 0);
      }
      const paramIndex = funcNode.expr().indexOf(childNode as ExprContext);
      const commaIndex = funcNode.COMMA().indexOf(childNode as TerminalNode);
      return paramIndex > -1 ? paramIndex : commaIndex;
    }
    return -1;
  }
}
