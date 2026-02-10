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
import { FieldType, FunctionName, normalizeFunctionNameAlias } from '@teable/v2-core';

import { FormulaSqlPgFunctions } from './FormulaSqlPgFunctions';
import type { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { buildErrorLiteral, sqlStringLiteral } from './PgSqlHelpers';
import { makeExpr, type SqlExpr } from './SqlExpression';

const DEFAULT_ERROR = buildErrorLiteral('INTERNAL', 'unexpected');

export class FormulaSqlPgVisitor
  extends AbstractParseTreeVisitor<SqlExpr>
  implements FormulaVisitor<SqlExpr>
{
  private readonly functions: FormulaSqlPgFunctions;
  private readonly functionHandlers: Partial<Record<FunctionName, (params: SqlExpr[]) => SqlExpr>>;

  constructor(private readonly translator: FormulaSqlPgTranslator) {
    super();
    this.functions = new FormulaSqlPgFunctions(translator);
    this.functionHandlers = this.functions.getHandlers();
  }

  protected defaultResult(): SqlExpr {
    return makeExpr('NULL', 'unknown', false, 'TRUE', DEFAULT_ERROR);
  }

  visitRoot(ctx: RootContext): SqlExpr {
    return ctx.expr().accept(this);
  }

  visitStringLiteral(ctx: StringLiteralContext): SqlExpr {
    const quotedString = ctx.text;
    const rawString = quotedString.slice(1, -1);
    const unescapedString = this.unescapeString(rawString);
    return makeExpr(sqlStringLiteral(unescapedString), 'string', false);
  }

  visitIntegerLiteral(ctx: IntegerLiteralContext): SqlExpr {
    const value = parseInt(ctx.text, 10);
    return makeExpr(Number.isFinite(value) ? value.toString() : '0', 'number', false);
  }

  visitDecimalLiteral(ctx: DecimalLiteralContext): SqlExpr {
    const value = Number(ctx.text);
    return makeExpr(Number.isFinite(value) ? value.toString() : '0', 'number', false);
  }

  visitBooleanLiteral(ctx: BooleanLiteralContext): SqlExpr {
    const value = ctx.text.toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
    return makeExpr(value, 'boolean', false);
  }

  visitLeftWhitespaceOrComments(ctx: LeftWhitespaceOrCommentsContext): SqlExpr {
    return ctx.expr().accept(this);
  }

  visitRightWhitespaceOrComments(ctx: RightWhitespaceOrCommentsContext): SqlExpr {
    return ctx.expr().accept(this);
  }

  visitBrackets(ctx: BracketsContext): SqlExpr {
    const inner = ctx.expr().accept(this);
    return { ...inner, valueSql: `(${inner.valueSql})` };
  }

  visitUnaryOp(ctx: UnaryOpContext): SqlExpr {
    const operand = ctx.expr().accept(this);
    if (ctx.MINUS()) {
      return this.functions.applyUnaryOp('minus', operand);
    }
    return makeExpr('NULL', 'unknown', false, 'TRUE', DEFAULT_ERROR);
  }

  visitBinaryOp(ctx: BinaryOpContext): SqlExpr {
    const left = ctx.expr(0).accept(this);
    const right = ctx.expr(1).accept(this);

    if (ctx.PLUS()) {
      return this.functions.applyBinaryOp('+', left, right);
    }
    if (ctx.MINUS()) {
      return this.functions.applyBinaryOp('-', left, right);
    }
    if (ctx.STAR()) {
      return this.functions.applyBinaryOp('*', left, right);
    }
    if (ctx.SLASH()) {
      return this.functions.applyBinaryOp('/', left, right);
    }
    if (ctx.PERCENT()) {
      return this.functions.applyBinaryOp('%', left, right);
    }
    if (ctx.EQUAL()) {
      return this.functions.applyBinaryOp('=', left, right);
    }
    if (ctx.BANG_EQUAL()) {
      return this.functions.applyBinaryOp('<>', left, right);
    }
    if (ctx.GT()) {
      return this.functions.applyBinaryOp('>', left, right);
    }
    if (ctx.GTE()) {
      return this.functions.applyBinaryOp('>=', left, right);
    }
    if (ctx.LT()) {
      return this.functions.applyBinaryOp('<', left, right);
    }
    if (ctx.LTE()) {
      return this.functions.applyBinaryOp('<=', left, right);
    }
    if (ctx.PIPE_PIPE()) {
      return this.functions.applyBinaryOp('OR', left, right);
    }
    if (ctx.AMP_AMP()) {
      return this.functions.applyBinaryOp('AND', left, right);
    }
    if (ctx.AMP()) {
      return this.functions.applyBinaryOp('&', left, right);
    }

    return makeExpr('NULL', 'unknown', false, 'TRUE', DEFAULT_ERROR);
  }

  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext): SqlExpr {
    const normalizedFieldId = extractFieldReferenceId(ctx);
    const rawToken = ctx.text;
    const fallback = rawToken?.slice(1, -1)?.trim() ?? '';
    const fieldId = normalizedFieldId ?? fallback;
    if (!fieldId) {
      return makeExpr('NULL', 'unknown', false, 'TRUE', buildErrorLiteral('REF', 'invalid_field'));
    }

    const resolved = this.translator.resolveFieldById(fieldId);
    if (resolved.isErr()) {
      return makeExpr('NULL', 'unknown', false, 'TRUE', buildErrorLiteral('REF', 'missing_field'));
    }

    const expr = resolved.value;

    // For JSON object fields (button, link), extract the display value (title/name)
    // when directly referenced in a formula. This ensures that {Button} and {LinkField}
    // return the human-readable title instead of the raw JSON object.
    if (expr.storageKind === 'json' && !expr.isArray && expr.field) {
      const fieldType = expr.field.type();
      if (fieldType.equals(FieldType.button()) || fieldType.equals(FieldType.link())) {
        const jsonbValue = `(${expr.valueSql})::jsonb`;
        const valueSql = `COALESCE(${jsonbValue}->>'title', ${jsonbValue}->>'name', ${jsonbValue} #>> '{}')`;
        return makeExpr(
          valueSql,
          'string',
          false,
          expr.errorConditionSql,
          expr.errorMessageSql,
          expr.field,
          'scalar'
        );
      }
    }

    return expr;
  }

  visitFunctionCall(ctx: FunctionCallContext): SqlExpr {
    const rawName = ctx.func_name().text.toUpperCase();
    const normalized = normalizeFunctionNameAlias(rawName);
    const functionName = normalized as FunctionName;
    const params = ctx.expr().map((exprCtx: ExprContext) => exprCtx.accept(this));
    const handler = this.functionHandlers[functionName];
    if (handler) {
      return handler(params);
    }
    return makeExpr('NULL', 'unknown', false, 'TRUE', buildErrorLiteral('NOT_IMPL', rawName));
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
