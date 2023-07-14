// Generated from src/query/parser/Query.g4 by ANTLR 4.9.0-SNAPSHOT

import type { ParseTreeVisitor } from 'antlr4ts/tree/ParseTreeVisitor';

import type {
  PredicateExprLikeContext,
  PredicateExprInContext,
  PredicateExprHasContext,
  PredicateExprEqArrayContext,
  PrimaryExprPredicateContext,
  PrimaryExprIsContext,
  PrimaryExprCompareContext,
  QueryExprContext,
  BinaryExprContext,
  ParenQueryExprContext,
  StartContext,
  ExprContext,
  QueryStatementContext,
  PredicateContext,
  FieldIdentifierContext,
  CompOpContext,
  IsOpContext,
  LikeOpContext,
  InOpContext,
  ValueContext,
  ValueListContext,
  LiteralContext,
  StringLiteralContext,
  NumberLiteralContext,
  BooleanLiteralContext,
  NullLiteralContext,
} from './Query';

/**
 * This interface defines a complete generic visitor for a parse tree produced
 * by `Query`.
 *
 * @param <Result> The return type of the visit operation. Use `void` for
 * operations with no return type.
 */
export interface QueryVisitor<Result> extends ParseTreeVisitor<Result> {
  /**
   * Visit a parse tree produced by the `predicateExprLike`
   * labeled alternative in `Query.predicate`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitPredicateExprLike?: (ctx: PredicateExprLikeContext) => Result;

  /**
   * Visit a parse tree produced by the `predicateExprIn`
   * labeled alternative in `Query.predicate`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitPredicateExprIn?: (ctx: PredicateExprInContext) => Result;

  /**
   * Visit a parse tree produced by the `predicateExprHas`
   * labeled alternative in `Query.predicate`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitPredicateExprHas?: (ctx: PredicateExprHasContext) => Result;

  /**
   * Visit a parse tree produced by the `predicateExprEqArray`
   * labeled alternative in `Query.predicate`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitPredicateExprEqArray?: (ctx: PredicateExprEqArrayContext) => Result;

  /**
   * Visit a parse tree produced by the `primaryExprPredicate`
   * labeled alternative in `Query.queryStatement`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitPrimaryExprPredicate?: (ctx: PrimaryExprPredicateContext) => Result;

  /**
   * Visit a parse tree produced by the `primaryExprIs`
   * labeled alternative in `Query.queryStatement`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitPrimaryExprIs?: (ctx: PrimaryExprIsContext) => Result;

  /**
   * Visit a parse tree produced by the `primaryExprCompare`
   * labeled alternative in `Query.queryStatement`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitPrimaryExprCompare?: (ctx: PrimaryExprCompareContext) => Result;

  /**
   * Visit a parse tree produced by the `queryExpr`
   * labeled alternative in `Query.expr`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitQueryExpr?: (ctx: QueryExprContext) => Result;

  /**
   * Visit a parse tree produced by the `binaryExpr`
   * labeled alternative in `Query.expr`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitBinaryExpr?: (ctx: BinaryExprContext) => Result;

  /**
   * Visit a parse tree produced by the `parenQueryExpr`
   * labeled alternative in `Query.expr`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitParenQueryExpr?: (ctx: ParenQueryExprContext) => Result;

  /**
   * Visit a parse tree produced by `Query.start`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitStart?: (ctx: StartContext) => Result;

  /**
   * Visit a parse tree produced by `Query.expr`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitExpr?: (ctx: ExprContext) => Result;

  /**
   * Visit a parse tree produced by `Query.queryStatement`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitQueryStatement?: (ctx: QueryStatementContext) => Result;

  /**
   * Visit a parse tree produced by `Query.predicate`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitPredicate?: (ctx: PredicateContext) => Result;

  /**
   * Visit a parse tree produced by `Query.fieldIdentifier`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitFieldIdentifier?: (ctx: FieldIdentifierContext) => Result;

  /**
   * Visit a parse tree produced by `Query.compOp`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitCompOp?: (ctx: CompOpContext) => Result;

  /**
   * Visit a parse tree produced by `Query.isOp`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitIsOp?: (ctx: IsOpContext) => Result;

  /**
   * Visit a parse tree produced by `Query.likeOp`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitLikeOp?: (ctx: LikeOpContext) => Result;

  /**
   * Visit a parse tree produced by `Query.inOp`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitInOp?: (ctx: InOpContext) => Result;

  /**
   * Visit a parse tree produced by `Query.value`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitValue?: (ctx: ValueContext) => Result;

  /**
   * Visit a parse tree produced by `Query.valueList`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitValueList?: (ctx: ValueListContext) => Result;

  /**
   * Visit a parse tree produced by `Query.literal`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitLiteral?: (ctx: LiteralContext) => Result;

  /**
   * Visit a parse tree produced by `Query.stringLiteral`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitStringLiteral?: (ctx: StringLiteralContext) => Result;

  /**
   * Visit a parse tree produced by `Query.numberLiteral`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitNumberLiteral?: (ctx: NumberLiteralContext) => Result;

  /**
   * Visit a parse tree produced by `Query.booleanLiteral`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitBooleanLiteral?: (ctx: BooleanLiteralContext) => Result;

  /**
   * Visit a parse tree produced by `Query.nullLiteral`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitNullLiteral?: (ctx: NullLiteralContext) => Result;
}
