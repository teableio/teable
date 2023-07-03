// Generated from src/query/parser/Query.g4 by ANTLR 4.9.0-SNAPSHOT

import type { ParseTreeVisitor } from 'antlr4ts/tree/ParseTreeVisitor';

import type {
  ParenExpressionContext,
  BinaryExpressionContext,
  SimpleComparisonContext,
  FieldComparisonContext,
  StartContext,
  ExpressionContext,
  ComparisonExpressionContext,
  BinaryOperatorContext,
  FieldContext,
  OperatorContext,
  ValueContext,
  LiteralContext,
  StringLiteralContext,
  NumberLiteralContext,
  BooleanLiteralContext,
  NullLiteralContext,
} from './QueryParser';

/**
 * This interface defines a complete generic visitor for a parse tree produced
 * by `QueryParser`.
 *
 * @param <Result> The return type of the visit operation. Use `void` for
 * operations with no return type.
 */
export interface QueryVisitor<Result> extends ParseTreeVisitor<Result> {
  /**
   * Visit a parse tree produced by the `parenExpression`
   * labeled alternative in `QueryParser.expression`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitParenExpression?: (ctx: ParenExpressionContext) => Result;

  /**
   * Visit a parse tree produced by the `binaryExpression`
   * labeled alternative in `QueryParser.expression`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitBinaryExpression?: (ctx: BinaryExpressionContext) => Result;

  /**
   * Visit a parse tree produced by the `simpleComparison`
   * labeled alternative in `QueryParser.expression`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitSimpleComparison?: (ctx: SimpleComparisonContext) => Result;

  /**
   * Visit a parse tree produced by the `fieldComparison`
   * labeled alternative in `QueryParser.comparisonExpression`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitFieldComparison?: (ctx: FieldComparisonContext) => Result;

  /**
   * Visit a parse tree produced by `QueryParser.start`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitStart?: (ctx: StartContext) => Result;

  /**
   * Visit a parse tree produced by `QueryParser.expression`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitExpression?: (ctx: ExpressionContext) => Result;

  /**
   * Visit a parse tree produced by `QueryParser.comparisonExpression`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitComparisonExpression?: (ctx: ComparisonExpressionContext) => Result;

  /**
   * Visit a parse tree produced by `QueryParser.binaryOperator`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitBinaryOperator?: (ctx: BinaryOperatorContext) => Result;

  /**
   * Visit a parse tree produced by `QueryParser.field`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitField?: (ctx: FieldContext) => Result;

  /**
   * Visit a parse tree produced by `QueryParser.operator`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitOperator?: (ctx: OperatorContext) => Result;

  /**
   * Visit a parse tree produced by `QueryParser.value`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitValue?: (ctx: ValueContext) => Result;

  /**
   * Visit a parse tree produced by `QueryParser.literal`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitLiteral?: (ctx: LiteralContext) => Result;

  /**
   * Visit a parse tree produced by `QueryParser.stringLiteral`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitStringLiteral?: (ctx: StringLiteralContext) => Result;

  /**
   * Visit a parse tree produced by `QueryParser.numberLiteral`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitNumberLiteral?: (ctx: NumberLiteralContext) => Result;

  /**
   * Visit a parse tree produced by `QueryParser.booleanLiteral`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitBooleanLiteral?: (ctx: BooleanLiteralContext) => Result;

  /**
   * Visit a parse tree produced by `QueryParser.nullLiteral`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitNullLiteral?: (ctx: NullLiteralContext) => Result;
}
