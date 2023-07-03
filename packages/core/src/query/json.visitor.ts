/* eslint-disable @typescript-eslint/no-explicit-any */
import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { AbstractParseTreeVisitor } from 'antlr4ts/tree';
import { isArray, isBoolean } from 'lodash';
import { $in, $isNotNull, $isNull, $notIn, operatorCrossReferenceTable } from '../models';
import { JsonErrorStrategy } from './json-error.strategy';
import { QueryLexer } from './parser/QueryLexer';
import type {
  BinaryExpressionContext,
  BinaryOperatorContext,
  BooleanLiteralContext,
  FieldComparisonContext,
  NumberLiteralContext,
  ParenExpressionContext,
  SimpleComparisonContext,
  StartContext,
  StringLiteralContext,
  ValueContext,
  NullLiteralContext,
} from './parser/QueryParser';
import { QueryParser } from './parser/QueryParser';
import type { QueryVisitor } from './parser/QueryVisitor';

export class JsonVisitor extends AbstractParseTreeVisitor<any> implements QueryVisitor<any> {
  defaultResult() {
    return null;
  }
  visitStart(ctx: StartContext) {
    let result = this.visit(ctx.expression());
    // If the result does not contain the filterSet and conjunction properties, then we need to create a new object
    if (!result.filterSet) {
      result = {
        filterSet: [result],
        conjunction: 'and',
      };
    }
    return result;
  }

  visitParenExpression(ctx: ParenExpressionContext) {
    // When the expression is surrounded by parentheses, we only need to access the expression inside it
    return this.visit(ctx.expression());
  }

  visitBinaryExpression(ctx: BinaryExpressionContext) {
    const binaryOperator = this.visit(ctx.binaryOperator());
    const expressions = ctx.expression();
    let leftExpr = this.visit(expressions[0]);
    const rightExpr = this.visit(expressions[1]);

    // If the expression is not a filter set, we convert it to a filter set
    if (!leftExpr.conjunction) {
      leftExpr = {
        filterSet: [leftExpr],
        conjunction: binaryOperator,
      };
    }

    // If the operator of the current left-hand expression is not the same as the given operator
    if (leftExpr.conjunction !== binaryOperator) {
      // If inconsistent, create a new object that contains a filter set with the left and right expressions
      // and set the concatenation of the new object to the given operator
      leftExpr = {
        filterSet: [leftExpr, rightExpr],
        conjunction: binaryOperator,
      };
    } else if (leftExpr.conjunction === rightExpr.conjunction) {
      leftExpr.filterSet.push(...rightExpr.filterSet);
    } else {
      leftExpr.filterSet.push(rightExpr);
    }

    return leftExpr;
  }

  visitSimpleComparison(ctx: SimpleComparisonContext) {
    return this.visit(ctx.comparisonExpression());
  }

  visitFieldComparison(ctx: FieldComparisonContext) {
    const fieldId = ctx.field().text.replace(/[{}]/g, '');

    const upperCaseOperator = ctx.operator().text.toUpperCase();
    const operator = operatorCrossReferenceTable.get(upperCaseOperator);

    const value = ctx.value()?.isEmpty ? null : this.visitValue(ctx.value()!);
    this.validateExpression(upperCaseOperator, value);

    return {
      fieldId: fieldId,
      operator: operator,
      value: value,
    };
  }

  visitValue(ctx: ValueContext): any {
    if (!ctx || ctx.isEmpty) {
      return null;
    }

    if (ctx.OPEN_PAREN() && ctx.CLOSE_PAREN()) {
      return ctx.literal().map((value) => this.visit(value));
    }

    return this.visit(ctx.literal(0));
  }

  visitBinaryOperator(ctx: BinaryOperatorContext): any {
    return ctx.text.toLowerCase();
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

  private validateExpression(operator: string, value: any) {
    if (
      !value &&
      !isBoolean(value) &&
      operator !== $isNull.value &&
      operator !== $isNotNull.value
    ) {
      throw new Error(`[${operator}] incomplete input`);
    } else if (
      value &&
      !isBoolean(value) &&
      (operator === $isNull.value || operator === $isNotNull.value)
    ) {
      throw new Error(`near "${value}": syntax error`);
    }

    if (isArray(value) && operator !== $in.value && operator !== $notIn.value) {
      throw new Error(`[${operator}] row value misused`);
    } else if (!isArray(value) && (operator === $in.value || operator === $notIn.value)) {
      throw new Error(`[IN] near "${value}": syntax error`);
    }
  }
}

// parse Teable Query Language
export const parseTQL = (input: string) => {
  const inputStream = CharStreams.fromString(input);
  const lexer = new QueryLexer(inputStream);
  const tokenStream = new CommonTokenStream(lexer);
  const parser = new QueryParser(tokenStream);

  parser.errorHandler = new JsonErrorStrategy();

  const tree = parser.start();
  const visitor = new JsonVisitor();
  return visitor.visit(tree);
};
