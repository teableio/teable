/* eslint-disable @typescript-eslint/no-explicit-any */
import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { AbstractParseTreeVisitor } from 'antlr4ts/tree';
import { operatorCrossReferenceTable } from '../models';
import { JsonErrorStrategy } from './json-error.strategy';
import type {
  BinaryExprContext,
  BooleanLiteralContext,
  FieldIdentifierContext,
  NullLiteralContext,
  NumberLiteralContext,
  ParenQueryExprContext,
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
  ValueListContext,
} from './parser/Query';
import { Query } from './parser/Query';
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
    const fieldId = this.visit(ctx.fieldIdentifier());

    const upperCaseOperator = ctx.isOp().text.toUpperCase();
    const operator = operatorCrossReferenceTable.get(upperCaseOperator);

    return {
      fieldId: fieldId,
      operator: operator,
      value: null,
    };
  }

  visitPrimaryExprCompare(ctx: PrimaryExprCompareContext): any {
    const fieldId = this.visit(ctx.fieldIdentifier());

    const upperCaseOperator = ctx.compOp().text.toUpperCase();
    const operator = operatorCrossReferenceTable.get(upperCaseOperator);

    const value = this.visitValue(ctx.value());
    return {
      fieldId: fieldId,
      operator: operator,
      value: value,
    };
  }

  visitPredicateExprLike(ctx: PredicateExprLikeContext): any {
    const fieldId = this.visit(ctx.fieldIdentifier());

    const upperCaseOperator = ctx.likeOp().text.toUpperCase();
    const operator = operatorCrossReferenceTable.get(upperCaseOperator);

    const value = this.visitValue(ctx.value());
    return {
      fieldId: fieldId,
      operator: operator,
      value: value,
    };
  }

  visitPredicateExprIn(ctx: PredicateExprInContext): any {
    const fieldId = this.visit(ctx.fieldIdentifier());

    const upperCaseOperator = ctx.inOp().text.toUpperCase();
    const operator = operatorCrossReferenceTable.get(upperCaseOperator);

    const valueList = this.visitValueList(ctx.valueList());
    return {
      fieldId: fieldId,
      operator: operator,
      value: valueList,
    };
  }

  visitPredicateExprHas(ctx: PredicateExprHasContext): any {
    const fieldId = this.visit(ctx.fieldIdentifier());

    const upperCaseOperator = ctx.HAS_SYMBOL().text.toUpperCase();
    const operator = operatorCrossReferenceTable.get(upperCaseOperator);

    const valueList = this.visitValueList(ctx.valueList());
    return {
      fieldId: fieldId,
      operator: operator,
      value: valueList,
    };
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
