// Generated from src/formula/parser/Formula.g4 by ANTLR 4.9.0-SNAPSHOT


import { ParseTreeVisitor } from "antlr4ts/tree/ParseTreeVisitor";

import { StringLiteralContext } from "./Formula";
import { IntegerLiteralContext } from "./Formula";
import { DecimalLiteralContext } from "./Formula";
import { BooleanLiteralContext } from "./Formula";
import { LeftWhitespaceOrCommentsContext } from "./Formula";
import { RightWhitespaceOrCommentsContext } from "./Formula";
import { BracketsContext } from "./Formula";
import { UnaryOpContext } from "./Formula";
import { BinaryOpContext } from "./Formula";
import { FieldReferenceCurlyContext } from "./Formula";
import { FunctionCallContext } from "./Formula";
import { RootContext } from "./Formula";
import { ExprContext } from "./Formula";
import { Ws_or_commentContext } from "./Formula";
import { Field_referenceContext } from "./Formula";
import { Field_reference_curlyContext } from "./Formula";
import { Func_nameContext } from "./Formula";
import { IdentifierContext } from "./Formula";


/**
 * This interface defines a complete generic visitor for a parse tree produced
 * by `Formula`.
 *
 * @param <Result> The return type of the visit operation. Use `void` for
 * operations with no return type.
 */
export interface FormulaVisitor<Result> extends ParseTreeVisitor<Result> {
	/**
	 * Visit a parse tree produced by the `StringLiteral`
	 * labeled alternative in `Formula.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitStringLiteral?: (ctx: StringLiteralContext) => Result;

	/**
	 * Visit a parse tree produced by the `IntegerLiteral`
	 * labeled alternative in `Formula.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitIntegerLiteral?: (ctx: IntegerLiteralContext) => Result;

	/**
	 * Visit a parse tree produced by the `DecimalLiteral`
	 * labeled alternative in `Formula.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitDecimalLiteral?: (ctx: DecimalLiteralContext) => Result;

	/**
	 * Visit a parse tree produced by the `BooleanLiteral`
	 * labeled alternative in `Formula.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitBooleanLiteral?: (ctx: BooleanLiteralContext) => Result;

	/**
	 * Visit a parse tree produced by the `LeftWhitespaceOrComments`
	 * labeled alternative in `Formula.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitLeftWhitespaceOrComments?: (ctx: LeftWhitespaceOrCommentsContext) => Result;

	/**
	 * Visit a parse tree produced by the `RightWhitespaceOrComments`
	 * labeled alternative in `Formula.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitRightWhitespaceOrComments?: (ctx: RightWhitespaceOrCommentsContext) => Result;

	/**
	 * Visit a parse tree produced by the `Brackets`
	 * labeled alternative in `Formula.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitBrackets?: (ctx: BracketsContext) => Result;

	/**
	 * Visit a parse tree produced by the `UnaryOp`
	 * labeled alternative in `Formula.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitUnaryOp?: (ctx: UnaryOpContext) => Result;

	/**
	 * Visit a parse tree produced by the `BinaryOp`
	 * labeled alternative in `Formula.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitBinaryOp?: (ctx: BinaryOpContext) => Result;

	/**
	 * Visit a parse tree produced by the `FieldReferenceCurly`
	 * labeled alternative in `Formula.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFieldReferenceCurly?: (ctx: FieldReferenceCurlyContext) => Result;

	/**
	 * Visit a parse tree produced by the `FunctionCall`
	 * labeled alternative in `Formula.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFunctionCall?: (ctx: FunctionCallContext) => Result;

	/**
	 * Visit a parse tree produced by `Formula.root`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitRoot?: (ctx: RootContext) => Result;

	/**
	 * Visit a parse tree produced by `Formula.expr`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitExpr?: (ctx: ExprContext) => Result;

	/**
	 * Visit a parse tree produced by `Formula.ws_or_comment`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitWs_or_comment?: (ctx: Ws_or_commentContext) => Result;

	/**
	 * Visit a parse tree produced by `Formula.field_reference`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitField_reference?: (ctx: Field_referenceContext) => Result;

	/**
	 * Visit a parse tree produced by `Formula.field_reference_curly`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitField_reference_curly?: (ctx: Field_reference_curlyContext) => Result;

	/**
	 * Visit a parse tree produced by `Formula.func_name`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFunc_name?: (ctx: Func_nameContext) => Result;

	/**
	 * Visit a parse tree produced by `Formula.identifier`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitIdentifier?: (ctx: IdentifierContext) => Result;
}

