// Generated from src/formula/parser/Formula.g4 by ANTLR 4.9.0-SNAPSHOT


import { ATN } from "antlr4ts/atn/ATN";
import { ATNDeserializer } from "antlr4ts/atn/ATNDeserializer";
import { FailedPredicateException } from "antlr4ts/FailedPredicateException";
import { NotNull } from "antlr4ts/Decorators";
import { NoViableAltException } from "antlr4ts/NoViableAltException";
import { Override } from "antlr4ts/Decorators";
import { Parser } from "antlr4ts/Parser";
import { ParserRuleContext } from "antlr4ts/ParserRuleContext";
import { ParserATNSimulator } from "antlr4ts/atn/ParserATNSimulator";
import { ParseTreeListener } from "antlr4ts/tree/ParseTreeListener";
import { ParseTreeVisitor } from "antlr4ts/tree/ParseTreeVisitor";
import { RecognitionException } from "antlr4ts/RecognitionException";
import { RuleContext } from "antlr4ts/RuleContext";
//import { RuleVersion } from "antlr4ts/RuleVersion";
import { TerminalNode } from "antlr4ts/tree/TerminalNode";
import { Token } from "antlr4ts/Token";
import { TokenStream } from "antlr4ts/TokenStream";
import { Vocabulary } from "antlr4ts/Vocabulary";
import { VocabularyImpl } from "antlr4ts/VocabularyImpl";

import * as Utils from "antlr4ts/misc/Utils";

import { FormulaVisitor } from "./FormulaVisitor";


export class Formula extends Parser {
	public static readonly BLOCK_COMMENT = 1;
	public static readonly LINE_COMMENT = 2;
	public static readonly WHITESPACE = 3;
	public static readonly TRUE = 4;
	public static readonly FALSE = 5;
	public static readonly FIELD = 6;
	public static readonly COMMA = 7;
	public static readonly COLON = 8;
	public static readonly COLON_COLON = 9;
	public static readonly DOLLAR = 10;
	public static readonly DOLLAR_DOLLAR = 11;
	public static readonly STAR = 12;
	public static readonly OPEN_PAREN = 13;
	public static readonly CLOSE_PAREN = 14;
	public static readonly OPEN_BRACKET = 15;
	public static readonly CLOSE_BRACKET = 16;
	public static readonly L_CURLY = 17;
	public static readonly R_CURLY = 18;
	public static readonly BIT_STRING = 19;
	public static readonly REGEX_STRING = 20;
	public static readonly NUMERIC_LITERAL = 21;
	public static readonly INTEGER_LITERAL = 22;
	public static readonly HEX_INTEGER_LITERAL = 23;
	public static readonly DOT = 24;
	public static readonly SINGLEQ_STRING_LITERAL = 25;
	public static readonly DOUBLEQ_STRING_LITERAL = 26;
	public static readonly IDENTIFIER_VARIABLE = 27;
	public static readonly IDENTIFIER_UNICODE = 28;
	public static readonly IDENTIFIER = 29;
	public static readonly AMP = 30;
	public static readonly AMP_AMP = 31;
	public static readonly AMP_LT = 32;
	public static readonly AT_AT = 33;
	public static readonly AT_GT = 34;
	public static readonly AT_SIGN = 35;
	public static readonly BANG = 36;
	public static readonly BANG_BANG = 37;
	public static readonly BANG_EQUAL = 38;
	public static readonly CARET = 39;
	public static readonly EQUAL = 40;
	public static readonly EQUAL_GT = 41;
	public static readonly GT = 42;
	public static readonly GTE = 43;
	public static readonly GT_GT = 44;
	public static readonly HASH = 45;
	public static readonly HASH_EQ = 46;
	public static readonly HASH_GT = 47;
	public static readonly HASH_GT_GT = 48;
	public static readonly HASH_HASH = 49;
	public static readonly HYPHEN_GT = 50;
	public static readonly HYPHEN_GT_GT = 51;
	public static readonly HYPHEN_PIPE_HYPHEN = 52;
	public static readonly LT = 53;
	public static readonly LTE = 54;
	public static readonly LT_AT = 55;
	public static readonly LT_CARET = 56;
	public static readonly LT_GT = 57;
	public static readonly LT_HYPHEN_GT = 58;
	public static readonly LT_LT = 59;
	public static readonly LT_LT_EQ = 60;
	public static readonly LT_QMARK_GT = 61;
	public static readonly MINUS = 62;
	public static readonly PERCENT = 63;
	public static readonly PIPE = 64;
	public static readonly PIPE_PIPE = 65;
	public static readonly PIPE_PIPE_SLASH = 66;
	public static readonly PIPE_SLASH = 67;
	public static readonly PLUS = 68;
	public static readonly QMARK = 69;
	public static readonly QMARK_AMP = 70;
	public static readonly QMARK_HASH = 71;
	public static readonly QMARK_HYPHEN = 72;
	public static readonly QMARK_PIPE = 73;
	public static readonly SLASH = 74;
	public static readonly TIL = 75;
	public static readonly TIL_EQ = 76;
	public static readonly TIL_GTE_TIL = 77;
	public static readonly TIL_GT_TIL = 78;
	public static readonly TIL_LTE_TIL = 79;
	public static readonly TIL_LT_TIL = 80;
	public static readonly TIL_STAR = 81;
	public static readonly TIL_TIL = 82;
	public static readonly SEMI = 83;
	public static readonly ErrorCharacter = 84;
	public static readonly RULE_root = 0;
	public static readonly RULE_expr = 1;
	public static readonly RULE_ws_or_comment = 2;
	public static readonly RULE_field_reference = 3;
	public static readonly RULE_field_reference_curly = 4;
	public static readonly RULE_func_name = 5;
	public static readonly RULE_identifier = 6;
	// tslint:disable:no-trailing-whitespace
	public static readonly ruleNames: string[] = [
		"root", "expr", "ws_or_comment", "field_reference", "field_reference_curly", 
		"func_name", "identifier",
	];

	private static readonly _LITERAL_NAMES: Array<string | undefined> = [
		undefined, undefined, undefined, undefined, undefined, undefined, undefined, 
		"','", "':'", "'::'", "'$'", "'$$'", "'*'", "'('", "')'", "'['", "']'", 
		"'{'", "'}'", undefined, undefined, undefined, undefined, undefined, "'.'", 
		undefined, undefined, undefined, undefined, undefined, "'&'", "'&&'", 
		"'&<'", "'@@'", "'@>'", "'@'", "'!'", "'!!'", "'!='", "'^'", "'='", "'=>'", 
		"'>'", "'>='", "'>>'", "'#'", "'#='", "'#>'", "'#>>'", "'##'", "'->'", 
		"'->>'", "'-|-'", "'<'", "'<='", "'<@'", "'<^'", "'<>'", "'<->'", "'<<'", 
		"'<<='", "'<?>'", "'-'", "'%'", "'|'", "'||'", "'||/'", "'|/'", "'+'", 
		"'?'", "'?&'", "'?#'", "'?-'", "'?|'", "'/'", "'~'", "'~='", "'~>=~'", 
		"'~>~'", "'~<=~'", "'~<~'", "'~*'", "'~~'", "';'",
	];
	private static readonly _SYMBOLIC_NAMES: Array<string | undefined> = [
		undefined, "BLOCK_COMMENT", "LINE_COMMENT", "WHITESPACE", "TRUE", "FALSE", 
		"FIELD", "COMMA", "COLON", "COLON_COLON", "DOLLAR", "DOLLAR_DOLLAR", "STAR", 
		"OPEN_PAREN", "CLOSE_PAREN", "OPEN_BRACKET", "CLOSE_BRACKET", "L_CURLY", 
		"R_CURLY", "BIT_STRING", "REGEX_STRING", "NUMERIC_LITERAL", "INTEGER_LITERAL", 
		"HEX_INTEGER_LITERAL", "DOT", "SINGLEQ_STRING_LITERAL", "DOUBLEQ_STRING_LITERAL", 
		"IDENTIFIER_VARIABLE", "IDENTIFIER_UNICODE", "IDENTIFIER", "AMP", "AMP_AMP", 
		"AMP_LT", "AT_AT", "AT_GT", "AT_SIGN", "BANG", "BANG_BANG", "BANG_EQUAL", 
		"CARET", "EQUAL", "EQUAL_GT", "GT", "GTE", "GT_GT", "HASH", "HASH_EQ", 
		"HASH_GT", "HASH_GT_GT", "HASH_HASH", "HYPHEN_GT", "HYPHEN_GT_GT", "HYPHEN_PIPE_HYPHEN", 
		"LT", "LTE", "LT_AT", "LT_CARET", "LT_GT", "LT_HYPHEN_GT", "LT_LT", "LT_LT_EQ", 
		"LT_QMARK_GT", "MINUS", "PERCENT", "PIPE", "PIPE_PIPE", "PIPE_PIPE_SLASH", 
		"PIPE_SLASH", "PLUS", "QMARK", "QMARK_AMP", "QMARK_HASH", "QMARK_HYPHEN", 
		"QMARK_PIPE", "SLASH", "TIL", "TIL_EQ", "TIL_GTE_TIL", "TIL_GT_TIL", "TIL_LTE_TIL", 
		"TIL_LT_TIL", "TIL_STAR", "TIL_TIL", "SEMI", "ErrorCharacter",
	];
	public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(Formula._LITERAL_NAMES, Formula._SYMBOLIC_NAMES, []);

	// @Override
	// @NotNull
	public get vocabulary(): Vocabulary {
		return Formula.VOCABULARY;
	}
	// tslint:enable:no-trailing-whitespace

	// @Override
	public get grammarFileName(): string { return "Formula.g4"; }

	// @Override
	public get ruleNames(): string[] { return Formula.ruleNames; }

	// @Override
	public get serializedATN(): string { return Formula._serializedATN; }

	protected createFailedPredicateException(predicate?: string, message?: string): FailedPredicateException {
		return new FailedPredicateException(this, predicate, message);
	}

	constructor(input: TokenStream) {
		super(input);
		this._interp = new ParserATNSimulator(Formula._ATN, this);
	}
	// @RuleVersion(0)
	public root(): RootContext {
		let _localctx: RootContext = new RootContext(this._ctx, this.state);
		this.enterRule(_localctx, 0, Formula.RULE_root);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 14;
			this.expr(0);
			this.state = 15;
			this.match(Formula.EOF);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}

	public expr(): ExprContext;
	public expr(_p: number): ExprContext;
	// @RuleVersion(0)
	public expr(_p?: number): ExprContext {
		if (_p === undefined) {
			_p = 0;
		}

		let _parentctx: ParserRuleContext = this._ctx;
		let _parentState: number = this.state;
		let _localctx: ExprContext = new ExprContext(this._ctx, _parentState);
		let _prevctx: ExprContext = _localctx;
		let _startState: number = 2;
		this.enterRecursionRule(_localctx, 2, Formula.RULE_expr, _p);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 47;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case Formula.SINGLEQ_STRING_LITERAL:
				{
				_localctx = new StringLiteralContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;

				this.state = 18;
				this.match(Formula.SINGLEQ_STRING_LITERAL);
				}
				break;
			case Formula.DOUBLEQ_STRING_LITERAL:
				{
				_localctx = new StringLiteralContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 19;
				this.match(Formula.DOUBLEQ_STRING_LITERAL);
				}
				break;
			case Formula.INTEGER_LITERAL:
				{
				_localctx = new IntegerLiteralContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 20;
				this.match(Formula.INTEGER_LITERAL);
				}
				break;
			case Formula.NUMERIC_LITERAL:
				{
				_localctx = new DecimalLiteralContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 21;
				this.match(Formula.NUMERIC_LITERAL);
				}
				break;
			case Formula.TRUE:
			case Formula.FALSE:
				{
				_localctx = new BooleanLiteralContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 22;
				_la = this._input.LA(1);
				if (!(_la === Formula.TRUE || _la === Formula.FALSE)) {
				this._errHandler.recoverInline(this);
				} else {
					if (this._input.LA(1) === Token.EOF) {
						this.matchedEOF = true;
					}

					this._errHandler.reportMatch(this);
					this.consume();
				}
				}
				break;
			case Formula.BLOCK_COMMENT:
			case Formula.LINE_COMMENT:
			case Formula.WHITESPACE:
				{
				_localctx = new LeftWhitespaceOrCommentsContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 23;
				this.ws_or_comment();
				this.state = 24;
				this.expr(13);
				}
				break;
			case Formula.OPEN_PAREN:
				{
				_localctx = new BracketsContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 26;
				this.match(Formula.OPEN_PAREN);
				this.state = 27;
				this.expr(0);
				this.state = 28;
				this.match(Formula.CLOSE_PAREN);
				}
				break;
			case Formula.MINUS:
				{
				_localctx = new UnaryOpContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 30;
				this.match(Formula.MINUS);
				this.state = 31;
				this.expr(10);
				}
				break;
			case Formula.IDENTIFIER_VARIABLE:
				{
				_localctx = new FieldReferenceCurlyContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 32;
				this.field_reference_curly();
				}
				break;
			case Formula.IDENTIFIER_UNICODE:
			case Formula.IDENTIFIER:
				{
				_localctx = new FunctionCallContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 33;
				this.func_name();
				this.state = 34;
				this.match(Formula.OPEN_PAREN);
				this.state = 43;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if ((((_la) & ~0x1F) === 0 && ((1 << _la) & ((1 << Formula.BLOCK_COMMENT) | (1 << Formula.LINE_COMMENT) | (1 << Formula.WHITESPACE) | (1 << Formula.TRUE) | (1 << Formula.FALSE) | (1 << Formula.OPEN_PAREN) | (1 << Formula.NUMERIC_LITERAL) | (1 << Formula.INTEGER_LITERAL) | (1 << Formula.SINGLEQ_STRING_LITERAL) | (1 << Formula.DOUBLEQ_STRING_LITERAL) | (1 << Formula.IDENTIFIER_VARIABLE) | (1 << Formula.IDENTIFIER_UNICODE) | (1 << Formula.IDENTIFIER))) !== 0) || _la === Formula.MINUS) {
					{
					this.state = 35;
					this.expr(0);
					this.state = 40;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la === Formula.COMMA) {
						{
						{
						this.state = 36;
						this.match(Formula.COMMA);
						this.state = 37;
						this.expr(0);
						}
						}
						this.state = 42;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					}
				}

				this.state = 45;
				this.match(Formula.CLOSE_PAREN);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
			this._ctx._stop = this._input.tryLT(-1);
			this.state = 74;
			this._errHandler.sync(this);
			_alt = this.interpreter.adaptivePredict(this._input, 4, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					if (this._parseListeners != null) {
						this.triggerExitRuleEvent();
					}
					_prevctx = _localctx;
					{
					this.state = 72;
					this._errHandler.sync(this);
					switch ( this.interpreter.adaptivePredict(this._input, 3, this._ctx) ) {
					case 1:
						{
						_localctx = new BinaryOpContext(new ExprContext(_parentctx, _parentState));
						this.pushNewRecursionContext(_localctx, _startState, Formula.RULE_expr);
						this.state = 49;
						if (!(this.precpred(this._ctx, 9))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 9)");
						}
						this.state = 50;
						(_localctx as BinaryOpContext)._op = this._input.LT(1);
						_la = this._input.LA(1);
						if (!(_la === Formula.STAR || _la === Formula.PERCENT || _la === Formula.SLASH)) {
							(_localctx as BinaryOpContext)._op = this._errHandler.recoverInline(this);
						} else {
							if (this._input.LA(1) === Token.EOF) {
								this.matchedEOF = true;
							}

							this._errHandler.reportMatch(this);
							this.consume();
						}
						this.state = 51;
						this.expr(10);
						}
						break;

					case 2:
						{
						_localctx = new BinaryOpContext(new ExprContext(_parentctx, _parentState));
						this.pushNewRecursionContext(_localctx, _startState, Formula.RULE_expr);
						this.state = 52;
						if (!(this.precpred(this._ctx, 8))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 8)");
						}
						this.state = 53;
						(_localctx as BinaryOpContext)._op = this._input.LT(1);
						_la = this._input.LA(1);
						if (!(_la === Formula.MINUS || _la === Formula.PLUS)) {
							(_localctx as BinaryOpContext)._op = this._errHandler.recoverInline(this);
						} else {
							if (this._input.LA(1) === Token.EOF) {
								this.matchedEOF = true;
							}

							this._errHandler.reportMatch(this);
							this.consume();
						}
						this.state = 54;
						this.expr(9);
						}
						break;

					case 3:
						{
						_localctx = new BinaryOpContext(new ExprContext(_parentctx, _parentState));
						this.pushNewRecursionContext(_localctx, _startState, Formula.RULE_expr);
						this.state = 55;
						if (!(this.precpred(this._ctx, 7))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 7)");
						}
						this.state = 56;
						(_localctx as BinaryOpContext)._op = this._input.LT(1);
						_la = this._input.LA(1);
						if (!(((((_la - 42)) & ~0x1F) === 0 && ((1 << (_la - 42)) & ((1 << (Formula.GT - 42)) | (1 << (Formula.GTE - 42)) | (1 << (Formula.LT - 42)) | (1 << (Formula.LTE - 42)))) !== 0))) {
							(_localctx as BinaryOpContext)._op = this._errHandler.recoverInline(this);
						} else {
							if (this._input.LA(1) === Token.EOF) {
								this.matchedEOF = true;
							}

							this._errHandler.reportMatch(this);
							this.consume();
						}
						this.state = 57;
						this.expr(8);
						}
						break;

					case 4:
						{
						_localctx = new BinaryOpContext(new ExprContext(_parentctx, _parentState));
						this.pushNewRecursionContext(_localctx, _startState, Formula.RULE_expr);
						this.state = 58;
						if (!(this.precpred(this._ctx, 6))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 6)");
						}
						this.state = 59;
						(_localctx as BinaryOpContext)._op = this._input.LT(1);
						_la = this._input.LA(1);
						if (!(_la === Formula.BANG_EQUAL || _la === Formula.EQUAL)) {
							(_localctx as BinaryOpContext)._op = this._errHandler.recoverInline(this);
						} else {
							if (this._input.LA(1) === Token.EOF) {
								this.matchedEOF = true;
							}

							this._errHandler.reportMatch(this);
							this.consume();
						}
						this.state = 60;
						this.expr(7);
						}
						break;

					case 5:
						{
						_localctx = new BinaryOpContext(new ExprContext(_parentctx, _parentState));
						this.pushNewRecursionContext(_localctx, _startState, Formula.RULE_expr);
						this.state = 61;
						if (!(this.precpred(this._ctx, 5))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 5)");
						}
						this.state = 62;
						(_localctx as BinaryOpContext)._op = this.match(Formula.AMP_AMP);
						this.state = 63;
						this.expr(6);
						}
						break;

					case 6:
						{
						_localctx = new BinaryOpContext(new ExprContext(_parentctx, _parentState));
						this.pushNewRecursionContext(_localctx, _startState, Formula.RULE_expr);
						this.state = 64;
						if (!(this.precpred(this._ctx, 4))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 4)");
						}
						this.state = 65;
						(_localctx as BinaryOpContext)._op = this.match(Formula.PIPE_PIPE);
						this.state = 66;
						this.expr(5);
						}
						break;

					case 7:
						{
						_localctx = new BinaryOpContext(new ExprContext(_parentctx, _parentState));
						this.pushNewRecursionContext(_localctx, _startState, Formula.RULE_expr);
						this.state = 67;
						if (!(this.precpred(this._ctx, 3))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 3)");
						}
						this.state = 68;
						(_localctx as BinaryOpContext)._op = this.match(Formula.AMP);
						this.state = 69;
						this.expr(4);
						}
						break;

					case 8:
						{
						_localctx = new RightWhitespaceOrCommentsContext(new ExprContext(_parentctx, _parentState));
						this.pushNewRecursionContext(_localctx, _startState, Formula.RULE_expr);
						this.state = 70;
						if (!(this.precpred(this._ctx, 12))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 12)");
						}
						this.state = 71;
						this.ws_or_comment();
						}
						break;
					}
					}
				}
				this.state = 76;
				this._errHandler.sync(this);
				_alt = this.interpreter.adaptivePredict(this._input, 4, this._ctx);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.unrollRecursionContexts(_parentctx);
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public ws_or_comment(): Ws_or_commentContext {
		let _localctx: Ws_or_commentContext = new Ws_or_commentContext(this._ctx, this.state);
		this.enterRule(_localctx, 4, Formula.RULE_ws_or_comment);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 77;
			_la = this._input.LA(1);
			if (!((((_la) & ~0x1F) === 0 && ((1 << _la) & ((1 << Formula.BLOCK_COMMENT) | (1 << Formula.LINE_COMMENT) | (1 << Formula.WHITESPACE))) !== 0))) {
			this._errHandler.recoverInline(this);
			} else {
				if (this._input.LA(1) === Token.EOF) {
					this.matchedEOF = true;
				}

				this._errHandler.reportMatch(this);
				this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public field_reference(): Field_referenceContext {
		let _localctx: Field_referenceContext = new Field_referenceContext(this._ctx, this.state);
		this.enterRule(_localctx, 6, Formula.RULE_field_reference);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 79;
			this.match(Formula.IDENTIFIER_UNICODE);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public field_reference_curly(): Field_reference_curlyContext {
		let _localctx: Field_reference_curlyContext = new Field_reference_curlyContext(this._ctx, this.state);
		this.enterRule(_localctx, 8, Formula.RULE_field_reference_curly);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 81;
			this.match(Formula.IDENTIFIER_VARIABLE);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public func_name(): Func_nameContext {
		let _localctx: Func_nameContext = new Func_nameContext(this._ctx, this.state);
		this.enterRule(_localctx, 10, Formula.RULE_func_name);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 83;
			this.identifier();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public identifier(): IdentifierContext {
		let _localctx: IdentifierContext = new IdentifierContext(this._ctx, this.state);
		this.enterRule(_localctx, 12, Formula.RULE_identifier);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 85;
			_la = this._input.LA(1);
			if (!(_la === Formula.IDENTIFIER_UNICODE || _la === Formula.IDENTIFIER)) {
			this._errHandler.recoverInline(this);
			} else {
				if (this._input.LA(1) === Token.EOF) {
					this.matchedEOF = true;
				}

				this._errHandler.reportMatch(this);
				this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}

	public sempred(_localctx: RuleContext, ruleIndex: number, predIndex: number): boolean {
		switch (ruleIndex) {
		case 1:
			return this.expr_sempred(_localctx as ExprContext, predIndex);
		}
		return true;
	}
	private expr_sempred(_localctx: ExprContext, predIndex: number): boolean {
		switch (predIndex) {
		case 0:
			return this.precpred(this._ctx, 9);

		case 1:
			return this.precpred(this._ctx, 8);

		case 2:
			return this.precpred(this._ctx, 7);

		case 3:
			return this.precpred(this._ctx, 6);

		case 4:
			return this.precpred(this._ctx, 5);

		case 5:
			return this.precpred(this._ctx, 4);

		case 6:
			return this.precpred(this._ctx, 3);

		case 7:
			return this.precpred(this._ctx, 12);
		}
		return true;
	}

	public static readonly _serializedATN: string =
		"\x03\uC91D\uCABA\u058D\uAFBA\u4F53\u0607\uEA8B\uC241\x03VZ\x04\x02\t\x02" +
		"\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04\x07\t\x07" +
		"\x04\b\t\b\x03\x02\x03\x02\x03\x02\x03\x03\x03\x03\x03\x03\x03\x03\x03" +
		"\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03" +
		"\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x07\x03)" +
		"\n\x03\f\x03\x0E\x03,\v\x03\x05\x03.\n\x03\x03\x03\x03\x03\x05\x032\n" +
		"\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03" +
		"\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03" +
		"\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x07\x03K\n\x03\f\x03\x0E" +
		"\x03N\v\x03\x03\x04\x03\x04\x03\x05\x03\x05\x03\x06\x03\x06\x03\x07\x03" +
		"\x07\x03\b\x03\b\x03\b\x02\x02\x03\x04\t\x02\x02\x04\x02\x06\x02\b\x02" +
		"\n\x02\f\x02\x0E\x02\x02\t\x03\x02\x06\x07\x05\x02\x0E\x0EAALL\x04\x02" +
		"@@FF\x04\x02,-78\x04\x02((**\x03\x02\x03\x05\x03\x02\x1E\x1F\x02e\x02" +
		"\x10\x03\x02\x02\x02\x041\x03\x02\x02\x02\x06O\x03\x02\x02\x02\bQ\x03" +
		"\x02\x02\x02\nS\x03\x02\x02\x02\fU\x03\x02\x02\x02\x0EW\x03\x02\x02\x02" +
		"\x10\x11\x05\x04\x03\x02\x11\x12\x07\x02\x02\x03\x12\x03\x03\x02\x02\x02" +
		"\x13\x14\b\x03\x01\x02\x142\x07\x1B\x02\x02\x152\x07\x1C\x02\x02\x162" +
		"\x07\x18\x02\x02\x172\x07\x17\x02\x02\x182\t\x02\x02\x02\x19\x1A\x05\x06" +
		"\x04\x02\x1A\x1B\x05\x04\x03\x0F\x1B2\x03\x02\x02\x02\x1C\x1D\x07\x0F" +
		"\x02\x02\x1D\x1E\x05\x04\x03\x02\x1E\x1F\x07\x10\x02\x02\x1F2\x03\x02" +
		"\x02\x02 !\x07@\x02\x02!2\x05\x04\x03\f\"2\x05\n\x06\x02#$\x05\f\x07\x02" +
		"$-\x07\x0F\x02\x02%*\x05\x04\x03\x02&\'\x07\t\x02\x02\')\x05\x04\x03\x02" +
		"(&\x03\x02\x02\x02),\x03\x02\x02\x02*(\x03\x02\x02\x02*+\x03\x02\x02\x02" +
		"+.\x03\x02\x02\x02,*\x03\x02\x02\x02-%\x03\x02\x02\x02-.\x03\x02\x02\x02" +
		"./\x03\x02\x02\x02/0\x07\x10\x02\x0202\x03\x02\x02\x021\x13\x03\x02\x02" +
		"\x021\x15\x03\x02\x02\x021\x16\x03\x02\x02\x021\x17\x03\x02\x02\x021\x18" +
		"\x03\x02\x02\x021\x19\x03\x02\x02\x021\x1C\x03\x02\x02\x021 \x03\x02\x02" +
		"\x021\"\x03\x02\x02\x021#\x03\x02\x02\x022L\x03\x02\x02\x0234\f\v\x02" +
		"\x0245\t\x03\x02\x025K\x05\x04\x03\f67\f\n\x02\x0278\t\x04\x02\x028K\x05" +
		"\x04\x03\v9:\f\t\x02\x02:;\t\x05\x02\x02;K\x05\x04\x03\n<=\f\b\x02\x02" +
		"=>\t\x06\x02\x02>K\x05\x04\x03\t?@\f\x07\x02\x02@A\x07!\x02\x02AK\x05" +
		"\x04\x03\bBC\f\x06\x02\x02CD\x07C\x02\x02DK\x05\x04\x03\x07EF\f\x05\x02" +
		"\x02FG\x07 \x02\x02GK\x05\x04\x03\x06HI\f\x0E\x02\x02IK\x05\x06\x04\x02" +
		"J3\x03\x02\x02\x02J6\x03\x02\x02\x02J9\x03\x02\x02\x02J<\x03\x02\x02\x02" +
		"J?\x03\x02\x02\x02JB\x03\x02\x02\x02JE\x03\x02\x02\x02JH\x03\x02\x02\x02" +
		"KN\x03\x02\x02\x02LJ\x03\x02\x02\x02LM\x03\x02\x02\x02M\x05\x03\x02\x02" +
		"\x02NL\x03\x02\x02\x02OP\t\x07\x02\x02P\x07\x03\x02\x02\x02QR\x07\x1E" +
		"\x02\x02R\t\x03\x02\x02\x02ST\x07\x1D\x02\x02T\v\x03\x02\x02\x02UV\x05" +
		"\x0E\b\x02V\r\x03\x02\x02\x02WX\t\b\x02\x02X\x0F\x03\x02\x02\x02\x07*" +
		"-1JL";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!Formula.__ATN) {
			Formula.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(Formula._serializedATN));
		}

		return Formula.__ATN;
	}

}

export class RootContext extends ParserRuleContext {
	public expr(): ExprContext {
		return this.getRuleContext(0, ExprContext);
	}
	public EOF(): TerminalNode { return this.getToken(Formula.EOF, 0); }
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return Formula.RULE_root; }
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitRoot) {
			return visitor.visitRoot(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ExprContext extends ParserRuleContext {
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return Formula.RULE_expr; }
	public copyFrom(ctx: ExprContext): void {
		super.copyFrom(ctx);
	}
}
export class StringLiteralContext extends ExprContext {
	public SINGLEQ_STRING_LITERAL(): TerminalNode | undefined { return this.tryGetToken(Formula.SINGLEQ_STRING_LITERAL, 0); }
	public DOUBLEQ_STRING_LITERAL(): TerminalNode | undefined { return this.tryGetToken(Formula.DOUBLEQ_STRING_LITERAL, 0); }
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitStringLiteral) {
			return visitor.visitStringLiteral(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class IntegerLiteralContext extends ExprContext {
	public INTEGER_LITERAL(): TerminalNode { return this.getToken(Formula.INTEGER_LITERAL, 0); }
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitIntegerLiteral) {
			return visitor.visitIntegerLiteral(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class DecimalLiteralContext extends ExprContext {
	public NUMERIC_LITERAL(): TerminalNode { return this.getToken(Formula.NUMERIC_LITERAL, 0); }
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitDecimalLiteral) {
			return visitor.visitDecimalLiteral(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class BooleanLiteralContext extends ExprContext {
	public TRUE(): TerminalNode | undefined { return this.tryGetToken(Formula.TRUE, 0); }
	public FALSE(): TerminalNode | undefined { return this.tryGetToken(Formula.FALSE, 0); }
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitBooleanLiteral) {
			return visitor.visitBooleanLiteral(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class LeftWhitespaceOrCommentsContext extends ExprContext {
	public ws_or_comment(): Ws_or_commentContext {
		return this.getRuleContext(0, Ws_or_commentContext);
	}
	public expr(): ExprContext {
		return this.getRuleContext(0, ExprContext);
	}
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitLeftWhitespaceOrComments) {
			return visitor.visitLeftWhitespaceOrComments(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class RightWhitespaceOrCommentsContext extends ExprContext {
	public expr(): ExprContext {
		return this.getRuleContext(0, ExprContext);
	}
	public ws_or_comment(): Ws_or_commentContext {
		return this.getRuleContext(0, Ws_or_commentContext);
	}
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitRightWhitespaceOrComments) {
			return visitor.visitRightWhitespaceOrComments(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class BracketsContext extends ExprContext {
	public OPEN_PAREN(): TerminalNode { return this.getToken(Formula.OPEN_PAREN, 0); }
	public expr(): ExprContext {
		return this.getRuleContext(0, ExprContext);
	}
	public CLOSE_PAREN(): TerminalNode { return this.getToken(Formula.CLOSE_PAREN, 0); }
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitBrackets) {
			return visitor.visitBrackets(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class UnaryOpContext extends ExprContext {
	public MINUS(): TerminalNode { return this.getToken(Formula.MINUS, 0); }
	public expr(): ExprContext {
		return this.getRuleContext(0, ExprContext);
	}
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitUnaryOp) {
			return visitor.visitUnaryOp(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class BinaryOpContext extends ExprContext {
	public _op!: Token;
	public expr(): ExprContext[];
	public expr(i: number): ExprContext;
	public expr(i?: number): ExprContext | ExprContext[] {
		if (i === undefined) {
			return this.getRuleContexts(ExprContext);
		} else {
			return this.getRuleContext(i, ExprContext);
		}
	}
	public SLASH(): TerminalNode | undefined { return this.tryGetToken(Formula.SLASH, 0); }
	public STAR(): TerminalNode | undefined { return this.tryGetToken(Formula.STAR, 0); }
	public PERCENT(): TerminalNode | undefined { return this.tryGetToken(Formula.PERCENT, 0); }
	public PLUS(): TerminalNode | undefined { return this.tryGetToken(Formula.PLUS, 0); }
	public MINUS(): TerminalNode | undefined { return this.tryGetToken(Formula.MINUS, 0); }
	public GT(): TerminalNode | undefined { return this.tryGetToken(Formula.GT, 0); }
	public LT(): TerminalNode | undefined { return this.tryGetToken(Formula.LT, 0); }
	public GTE(): TerminalNode | undefined { return this.tryGetToken(Formula.GTE, 0); }
	public LTE(): TerminalNode | undefined { return this.tryGetToken(Formula.LTE, 0); }
	public EQUAL(): TerminalNode | undefined { return this.tryGetToken(Formula.EQUAL, 0); }
	public BANG_EQUAL(): TerminalNode | undefined { return this.tryGetToken(Formula.BANG_EQUAL, 0); }
	public AMP_AMP(): TerminalNode | undefined { return this.tryGetToken(Formula.AMP_AMP, 0); }
	public PIPE_PIPE(): TerminalNode | undefined { return this.tryGetToken(Formula.PIPE_PIPE, 0); }
	public AMP(): TerminalNode | undefined { return this.tryGetToken(Formula.AMP, 0); }
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitBinaryOp) {
			return visitor.visitBinaryOp(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class FieldReferenceCurlyContext extends ExprContext {
	public field_reference_curly(): Field_reference_curlyContext {
		return this.getRuleContext(0, Field_reference_curlyContext);
	}
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitFieldReferenceCurly) {
			return visitor.visitFieldReferenceCurly(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class FunctionCallContext extends ExprContext {
	public func_name(): Func_nameContext {
		return this.getRuleContext(0, Func_nameContext);
	}
	public OPEN_PAREN(): TerminalNode { return this.getToken(Formula.OPEN_PAREN, 0); }
	public CLOSE_PAREN(): TerminalNode { return this.getToken(Formula.CLOSE_PAREN, 0); }
	public expr(): ExprContext[];
	public expr(i: number): ExprContext;
	public expr(i?: number): ExprContext | ExprContext[] {
		if (i === undefined) {
			return this.getRuleContexts(ExprContext);
		} else {
			return this.getRuleContext(i, ExprContext);
		}
	}
	public COMMA(): TerminalNode[];
	public COMMA(i: number): TerminalNode;
	public COMMA(i?: number): TerminalNode | TerminalNode[] {
		if (i === undefined) {
			return this.getTokens(Formula.COMMA);
		} else {
			return this.getToken(Formula.COMMA, i);
		}
	}
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitFunctionCall) {
			return visitor.visitFunctionCall(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class Ws_or_commentContext extends ParserRuleContext {
	public BLOCK_COMMENT(): TerminalNode | undefined { return this.tryGetToken(Formula.BLOCK_COMMENT, 0); }
	public LINE_COMMENT(): TerminalNode | undefined { return this.tryGetToken(Formula.LINE_COMMENT, 0); }
	public WHITESPACE(): TerminalNode | undefined { return this.tryGetToken(Formula.WHITESPACE, 0); }
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return Formula.RULE_ws_or_comment; }
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitWs_or_comment) {
			return visitor.visitWs_or_comment(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class Field_referenceContext extends ParserRuleContext {
	public IDENTIFIER_UNICODE(): TerminalNode { return this.getToken(Formula.IDENTIFIER_UNICODE, 0); }
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return Formula.RULE_field_reference; }
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitField_reference) {
			return visitor.visitField_reference(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class Field_reference_curlyContext extends ParserRuleContext {
	public IDENTIFIER_VARIABLE(): TerminalNode { return this.getToken(Formula.IDENTIFIER_VARIABLE, 0); }
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return Formula.RULE_field_reference_curly; }
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitField_reference_curly) {
			return visitor.visitField_reference_curly(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class Func_nameContext extends ParserRuleContext {
	public identifier(): IdentifierContext {
		return this.getRuleContext(0, IdentifierContext);
	}
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return Formula.RULE_func_name; }
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitFunc_name) {
			return visitor.visitFunc_name(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class IdentifierContext extends ParserRuleContext {
	public IDENTIFIER(): TerminalNode | undefined { return this.tryGetToken(Formula.IDENTIFIER, 0); }
	public IDENTIFIER_UNICODE(): TerminalNode | undefined { return this.tryGetToken(Formula.IDENTIFIER_UNICODE, 0); }
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return Formula.RULE_identifier; }
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitIdentifier) {
			return visitor.visitIdentifier(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


