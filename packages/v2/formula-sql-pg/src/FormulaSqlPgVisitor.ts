/* eslint-disable sonarjs/no-duplicate-string */
import type {
  BinaryOpContext,
  BooleanLiteralContext,
  BracketsContext,
  DecimalLiteralContext,
  ExprContext,
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
import { AbstractParseTreeVisitor, extractFieldReferenceId } from '@teable/formula';
import { normalizeFunctionNameAlias } from '@teable/v2-core';

import { FormulaExpressionGraph, type FormulaExpressionNode } from './FormulaExpressionGraph';
import type { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { buildErrorLiteral, sqlStringLiteral } from './PgSqlHelpers';
import { makeExpr, type SqlExpr } from './SqlExpression';

const DEFAULT_ERROR = buildErrorLiteral('INTERNAL', 'unexpected');
export class FormulaSqlPgVisitor
  extends AbstractParseTreeVisitor<FormulaExpressionNode>
  implements FormulaVisitor<FormulaExpressionNode>
{
  constructor(
    private readonly translator: FormulaSqlPgTranslator,
    private readonly graph: FormulaExpressionGraph = new FormulaExpressionGraph()
  ) {
    super();
  }

  private leaf(expression: SqlExpr): FormulaExpressionNode {
    return this.graph.intern({ kind: 'leaf', expression });
  }

  protected defaultResult(): FormulaExpressionNode {
    return this.leaf(makeExpr('NULL', 'unknown', false, 'TRUE', DEFAULT_ERROR));
  }

  visitRoot(ctx: RootContext): FormulaExpressionNode {
    return ctx.expr().accept(this);
  }

  visitStringLiteral(ctx: StringLiteralContext): FormulaExpressionNode {
    const quotedString = ctx.text;
    const rawString = quotedString.slice(1, -1);
    const unescapedString = this.unescapeString(rawString);
    return this.leaf(makeExpr(sqlStringLiteral(unescapedString), 'string', false));
  }

  visitIntegerLiteral(ctx: IntegerLiteralContext): FormulaExpressionNode {
    const value = parseInt(ctx.text, 10);
    return this.leaf(makeExpr(Number.isFinite(value) ? value.toString() : '0', 'number', false));
  }

  visitDecimalLiteral(ctx: DecimalLiteralContext): FormulaExpressionNode {
    const value = Number(ctx.text);
    return this.leaf(makeExpr(Number.isFinite(value) ? value.toString() : '0', 'number', false));
  }

  visitBooleanLiteral(ctx: BooleanLiteralContext): FormulaExpressionNode {
    const value = ctx.text.toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
    return this.leaf(makeExpr(value, 'boolean', false));
  }

  visitLeftWhitespaceOrComments(ctx: LeftWhitespaceOrCommentsContext): FormulaExpressionNode {
    return ctx.expr().accept(this);
  }

  visitRightWhitespaceOrComments(ctx: RightWhitespaceOrCommentsContext): FormulaExpressionNode {
    return ctx.expr().accept(this);
  }

  visitBrackets(ctx: BracketsContext): FormulaExpressionNode {
    return ctx.expr().accept(this);
  }

  visitUnaryOp(ctx: UnaryOpContext): FormulaExpressionNode {
    const operand = ctx.expr().accept(this);
    if (ctx.MINUS()) {
      return this.graph.intern({ kind: 'unary', operator: 'minus', operand });
    }
    return this.leaf(makeExpr('NULL', 'unknown', false, 'TRUE', DEFAULT_ERROR));
  }

  visitBinaryOp(ctx: BinaryOpContext): FormulaExpressionNode {
    const left = ctx.expr(0).accept(this);
    const right = ctx.expr(1).accept(this);

    if (ctx.PLUS()) {
      return this.graph.intern({ kind: 'binary', operator: '+', left, right });
    }
    if (ctx.MINUS()) {
      return this.graph.intern({ kind: 'binary', operator: '-', left, right });
    }
    if (ctx.STAR()) {
      return this.graph.intern({ kind: 'binary', operator: '*', left, right });
    }
    if (ctx.SLASH()) {
      return this.graph.intern({ kind: 'binary', operator: '/', left, right });
    }
    if (ctx.PERCENT()) {
      return this.graph.intern({ kind: 'binary', operator: '%', left, right });
    }
    if (ctx.EQUAL()) {
      return this.graph.intern({ kind: 'binary', operator: '=', left, right });
    }
    if (ctx.BANG_EQUAL()) {
      return this.graph.intern({ kind: 'binary', operator: '<>', left, right });
    }
    if (ctx.GT()) {
      return this.graph.intern({ kind: 'binary', operator: '>', left, right });
    }
    if (ctx.GTE()) {
      return this.graph.intern({ kind: 'binary', operator: '>=', left, right });
    }
    if (ctx.LT()) {
      return this.graph.intern({ kind: 'binary', operator: '<', left, right });
    }
    if (ctx.LTE()) {
      return this.graph.intern({ kind: 'binary', operator: '<=', left, right });
    }
    if (ctx.PIPE_PIPE()) {
      return this.graph.intern({ kind: 'binary', operator: 'OR', left, right });
    }
    if (ctx.AMP_AMP()) {
      return this.graph.intern({ kind: 'binary', operator: 'AND', left, right });
    }
    if (ctx.AMP()) {
      return this.graph.intern({ kind: 'binary', operator: '&', left, right });
    }

    return this.leaf(makeExpr('NULL', 'unknown', false, 'TRUE', DEFAULT_ERROR));
  }

  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext): FormulaExpressionNode {
    const normalizedFieldId = extractFieldReferenceId(ctx);
    const rawToken = ctx.text;
    const fallback = rawToken?.slice(1, -1)?.trim() ?? '';
    const fieldId = normalizedFieldId ?? fallback;
    if (!fieldId) {
      return this.leaf(
        makeExpr('NULL', 'unknown', false, 'TRUE', buildErrorLiteral('REF', 'invalid_field'))
      );
    }

    const resolved = this.translator.resolveFieldNode(fieldId, this.graph);
    if (resolved.isErr()) {
      return this.leaf(
        makeExpr('NULL', 'unknown', false, 'TRUE', buildErrorLiteral('REF', 'missing_field'))
      );
    }
    return resolved.value;
  }

  visitFunctionCall(ctx: FunctionCallContext): FormulaExpressionNode {
    const rawName = ctx.func_name().text.toUpperCase();
    const normalized = normalizeFunctionNameAlias(rawName);
    const args = ctx.expr().map((exprCtx: ExprContext) => exprCtx.accept(this));
    return this.graph.intern({ kind: 'call', name: normalized, args });
  }

  private unescapeString(str: string): string {
    return str.replace(/\\(.)/g, (_match, char: string) => {
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
          return `\\${char}`;
      }
    });
  }
}
