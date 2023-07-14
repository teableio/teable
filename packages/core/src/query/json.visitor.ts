/* eslint-disable @typescript-eslint/no-explicit-any */
import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { AbstractParseTreeVisitor } from 'antlr4ts/tree';
import { JsonErrorStrategy } from './json-error.strategy';
import type {
  BinaryExprContext,
  BooleanLiteralContext,
  FieldIdentifierContext,
  NullLiteralContext,
  NumberLiteralContext,
  ParenQueryExprContext,
  PredicateExprEqArrayContext,
  PredicateExprHasContext,
  PredicateExprInContext,
  PredicateExprLikeContext,
  PrimaryExprCompareContext,
  PrimaryExprIsContext,
  PrimaryExprPredicateContext,
  QueryExprContext,
  StartContext,
  StringLiteralContext,
  ValueContext,
} from './parser/Query';
import { Query, ValueListContext } from './parser/Query';
import { QueryLexer } from './parser/QueryLexer';
import type { QueryVisitor } from './parser/QueryVisitor';

export class JsonVisitor extends AbstractParseTreeVisitor<any> implements QueryVisitor<any> {
  defaultResult() {
    return null;
  }

  visitStart(ctx: StartContext) {
    let result = this.visit(ctx.expr());
    if (!result) {
      return this.defaultResult();
    }

    // If the result does not contain the filterSet and conjunction properties, then we need to create a new object
    if (!result.filterSet) {
      result = {
        filterSet: [result],
        conjunction: 'and',
      };
    }
    return result;
  }

  visitQueryExpr(ctx: QueryExprContext): any {
    return this.visit(ctx.queryStatement());
  }

  visitParenQueryExpr(ctx: ParenQueryExprContext): any {
    return this.visit(ctx.expr());
  }

  visitBinaryExpr(ctx: BinaryExprContext): any {
    const operator = ctx?._op?.text?.toLowerCase();
    const expressions = ctx.expr();
    let leftExpr = this.visit(expressions[0]);
    const rightExpr = this.visit(expressions[1]);

    // If the expression is not a filter set, we convert it to a filter set
    if (!leftExpr.conjunction) {
      leftExpr = {
        filterSet: [leftExpr],
        conjunction: operator,
      };
    }

    // If the operator of the current left-hand expression is not the same as the given operator
    if (leftExpr.conjunction !== operator) {
      // If inconsistent, create a new object that contains a filter set with the left and right expressions
      // and set the concatenation of the new object to the given operator
      leftExpr = {
        filterSet: [leftExpr, rightExpr],
        conjunction: operator,
      };
    } else if (leftExpr.conjunction === rightExpr.conjunction) {
      leftExpr.filterSet.push(...rightExpr.filterSet);
    } else {
      leftExpr.filterSet.push(rightExpr);
    }

    return leftExpr;
  }

  visitFieldIdentifier(ctx: FieldIdentifierContext): any {
    return ctx.text.replace(/[{}]/g, '');
  }

  visitPrimaryExprPredicate(ctx: PrimaryExprPredicateContext): any {
    return this.visit(ctx.predicate());
  }

  visitPrimaryExprIs(ctx: PrimaryExprIsContext): any {
    return this.createResult(ctx.fieldIdentifier(), ctx.isOp().text);
  }

  visitPrimaryExprCompare(ctx: PrimaryExprCompareContext): any {
    return this.createResult(ctx.fieldIdentifier(), ctx.compOp().text, ctx.value());
  }

  visitPredicateExprLike(ctx: PredicateExprLikeContext): any {
    return this.createResult(ctx.fieldIdentifier(), ctx.likeOp().text, ctx.value());
  }

  visitPredicateExprIn(ctx: PredicateExprInContext): any {
    return this.createResult(ctx.fieldIdentifier(), ctx.inOp().text, ctx.valueList());
  }

  visitPredicateExprHas(ctx: PredicateExprHasContext): any {
    return this.createResult(ctx.fieldIdentifier(), ctx.HAS_SYMBOL().text, ctx.valueList());
  }

  visitPredicateExprEqArray(ctx: PredicateExprEqArrayContext): any {
    return this.createResult(ctx.fieldIdentifier(), ctx.EQUAL_OPERATOR().text, ctx.valueList());
  }

  visitValue(ctx: ValueContext): any {
    return this.visit(ctx.literal());
  }

  visitValueList(ctx: ValueListContext): any {
    return ctx.literal().map((value) => this.visit(value));
  }

  visitStringLiteral(ctx: StringLiteralContext): any {
    return ctx.text.slice(1, -1);
  }

  visitNumberLiteral(ctx: NumberLiteralContext): any {
    return Number(ctx.text);
  }

  visitBooleanLiteral(ctx: BooleanLiteralContext): any {
    return ctx.text.toUpperCase() === 'TRUE';
  }

  visitNullLiteral(_ctx: NullLiteralContext): any {
    return null;
  }

  private createResult(
    fieldCtx: FieldIdentifierContext,
    operatorCtx: string,
    valueCtx?: ValueContext | ValueListContext
  ) {
    const fieldId = this.visit(fieldCtx);

    const operator = operatorCtx.toUpperCase() === '<>' ? '!=' : operatorCtx.toUpperCase();

    let value = null;
    if (valueCtx) {
      if (valueCtx instanceof ValueListContext) {
        value = this.visitValueList(valueCtx);
      } else {
        value = this.visitValue(valueCtx);
      }
    }

    return {
      isSymbol: true,
      fieldId: fieldId,
      operator: operator,
      value: value,
    };
  }
}

// parse Teable Query Language
export const parseTQL = (input: string) => {
  const inputStream = CharStreams.fromString(input);
  const lexer = new QueryLexer(inputStream);
  const tokenStream = new CommonTokenStream(lexer);
  const parser = new Query(tokenStream);

  parser.errorHandler = new JsonErrorStrategy();

  const tree = parser.start();
  const visitor = new JsonVisitor();
  return visitor.visit(tree);
};
