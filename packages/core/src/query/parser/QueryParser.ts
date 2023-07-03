// Generated from src/query/parser/Query.g4 by ANTLR 4.9.0-SNAPSHOT

import { ATN } from 'antlr4ts/atn/ATN';
import { ATNDeserializer } from 'antlr4ts/atn/ATNDeserializer';
import { ParserATNSimulator } from 'antlr4ts/atn/ParserATNSimulator';
import { NotNull, Override } from 'antlr4ts/Decorators';
import { FailedPredicateException } from 'antlr4ts/FailedPredicateException';
import * as Utils from 'antlr4ts/misc/Utils';
import { NoViableAltException } from 'antlr4ts/NoViableAltException';
import { Parser } from 'antlr4ts/Parser';
import { ParserRuleContext } from 'antlr4ts/ParserRuleContext';
import { RecognitionException } from 'antlr4ts/RecognitionException';
import type { RuleContext } from 'antlr4ts/RuleContext';
import { Token } from 'antlr4ts/Token';
import type { TokenStream } from 'antlr4ts/TokenStream';
import { ParseTreeListener } from 'antlr4ts/tree/ParseTreeListener';
import { ParseTreeVisitor } from 'antlr4ts/tree/ParseTreeVisitor';
// import { RuleVersion } from "antlr4ts/RuleVersion";
import type { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import type { Vocabulary } from 'antlr4ts/Vocabulary';
import { VocabularyImpl } from 'antlr4ts/VocabularyImpl';

import type { QueryVisitor } from './QueryVisitor';

export class QueryParser extends Parser {
  public static readonly COMMA = 1;
  public static readonly OPEN_PAREN = 2;
  public static readonly CLOSE_PAREN = 3;
  public static readonly OPEN_BRACKET = 4;
  public static readonly CLOSE_BRACKET = 5;
  public static readonly L_CURLY = 6;
  public static readonly R_CURLY = 7;
  public static readonly FIELD = 8;
  public static readonly SINGLEQ_STRING_LITERAL = 9;
  public static readonly DOUBLEQ_STRING_LITERAL = 10;
  public static readonly INTEGER_LITERAL = 11;
  public static readonly NUMERIC_LITERAL = 12;
  public static readonly TRUE = 13;
  public static readonly FALSE = 14;
  public static readonly NULL = 15;
  public static readonly AND = 16;
  public static readonly OR = 17;
  public static readonly EQUAL = 18;
  public static readonly NOT_EQUAL = 19;
  public static readonly GT = 20;
  public static readonly GTE = 21;
  public static readonly LT = 22;
  public static readonly LTE = 23;
  public static readonly LIKE = 24;
  public static readonly IN = 25;
  public static readonly NOT_LIKE = 26;
  public static readonly NOT_IN = 27;
  public static readonly IS_NULL = 28;
  public static readonly IS_NOT_NULL = 29;
  public static readonly WS = 30;
  public static readonly NOT_EQUAL2 = 31;
  public static readonly RULE_start = 0;
  public static readonly RULE_expression = 1;
  public static readonly RULE_comparisonExpression = 2;
  public static readonly RULE_binaryOperator = 3;
  public static readonly RULE_field = 4;
  public static readonly RULE_operator = 5;
  public static readonly RULE_value = 6;
  public static readonly RULE_literal = 7;
  public static readonly RULE_stringLiteral = 8;
  public static readonly RULE_numberLiteral = 9;
  public static readonly RULE_booleanLiteral = 10;
  public static readonly RULE_nullLiteral = 11;
  public static readonly ruleNames: string[] = [
    'start',
    'expression',
    'comparisonExpression',
    'binaryOperator',
    'field',
    'operator',
    'value',
    'literal',
    'stringLiteral',
    'numberLiteral',
    'booleanLiteral',
    'nullLiteral',
  ];

  private static readonly _LITERAL_NAMES: Array<string | undefined> = [
    undefined,
    "','",
    "'('",
    "')'",
    "'['",
    "']'",
    "'{'",
    "'}'",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "'='",
    "'!='",
    "'>'",
    "'>='",
    "'<'",
    "'<='",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "'<>'",
  ];
  private static readonly _SYMBOLIC_NAMES: Array<string | undefined> = [
    undefined,
    'COMMA',
    'OPEN_PAREN',
    'CLOSE_PAREN',
    'OPEN_BRACKET',
    'CLOSE_BRACKET',
    'L_CURLY',
    'R_CURLY',
    'FIELD',
    'SINGLEQ_STRING_LITERAL',
    'DOUBLEQ_STRING_LITERAL',
    'INTEGER_LITERAL',
    'NUMERIC_LITERAL',
    'TRUE',
    'FALSE',
    'NULL',
    'AND',
    'OR',
    'EQUAL',
    'NOT_EQUAL',
    'GT',
    'GTE',
    'LT',
    'LTE',
    'LIKE',
    'IN',
    'NOT_LIKE',
    'NOT_IN',
    'IS_NULL',
    'IS_NOT_NULL',
    'WS',
    'NOT_EQUAL2',
  ];
  public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(
    QueryParser._LITERAL_NAMES,
    QueryParser._SYMBOLIC_NAMES,
    []
  );

  // @Override
  // @NotNull
  public get vocabulary(): Vocabulary {
    return QueryParser.VOCABULARY;
  }

  // @Override
  public get grammarFileName(): string {
    return 'Query.g4';
  }

  // @Override
  public get ruleNames(): string[] {
    return QueryParser.ruleNames;
  }

  // @Override
  public get serializedATN(): string {
    return QueryParser._serializedATN;
  }

  protected createFailedPredicateException(
    predicate?: string,
    message?: string
  ): FailedPredicateException {
    return new FailedPredicateException(this, predicate, message);
  }

  constructor(input: TokenStream) {
    super(input);
    this._interp = new ParserATNSimulator(QueryParser._ATN, this);
  }
  // @RuleVersion(0)
  public start(): StartContext {
    const _localctx: StartContext = new StartContext(this._ctx, this.state);
    this.enterRule(_localctx, 0, QueryParser.RULE_start);
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 24;
        this.expression(0);
        this.state = 25;
        this.match(QueryParser.EOF);
      }
    } catch (re) {
      if (re instanceof RecognitionException) {
        _localctx.exception = re;
        this._errHandler.reportError(this, re);
        this._errHandler.recover(this, re);
      } else {
        throw re;
      }
    } finally {
      this.exitRule();
    }
    return _localctx;
  }

  public expression(): ExpressionContext;
  public expression(_p: number): ExpressionContext;
  // @RuleVersion(0)
  public expression(_p?: number): ExpressionContext {
    if (_p === undefined) {
      _p = 0;
    }

    const _parentctx: ParserRuleContext = this._ctx;
    const _parentState: number = this.state;
    let _localctx: ExpressionContext = new ExpressionContext(this._ctx, _parentState);
    let _prevctx: ExpressionContext = _localctx;
    const _startState = 2;
    this.enterRecursionRule(_localctx, 2, QueryParser.RULE_expression, _p);
    try {
      let _alt: number;
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 33;
        this._errHandler.sync(this);
        switch (this._input.LA(1)) {
          case QueryParser.OPEN_PAREN:
            {
              _localctx = new ParenExpressionContext(_localctx);
              this._ctx = _localctx;
              _prevctx = _localctx;

              this.state = 28;
              this.match(QueryParser.OPEN_PAREN);
              this.state = 29;
              this.expression(0);
              this.state = 30;
              this.match(QueryParser.CLOSE_PAREN);
            }
            break;
          case QueryParser.FIELD:
            {
              _localctx = new SimpleComparisonContext(_localctx);
              this._ctx = _localctx;
              _prevctx = _localctx;
              this.state = 32;
              this.comparisonExpression();
            }
            break;
          default:
            throw new NoViableAltException(this);
        }
        this._ctx._stop = this._input.tryLT(-1);
        this.state = 41;
        this._errHandler.sync(this);
        _alt = this.interpreter.adaptivePredict(this._input, 1, this._ctx);
        while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
          if (_alt === 1) {
            if (this._parseListeners != null) {
              this.triggerExitRuleEvent();
            }
            _prevctx = _localctx;
            {
              {
                _localctx = new BinaryExpressionContext(
                  new ExpressionContext(_parentctx, _parentState)
                );
                this.pushNewRecursionContext(_localctx, _startState, QueryParser.RULE_expression);
                this.state = 35;
                if (!this.precpred(this._ctx, 2)) {
                  throw this.createFailedPredicateException('this.precpred(this._ctx, 2)');
                }
                this.state = 36;
                this.binaryOperator();
                this.state = 37;
                this.expression(3);
              }
            }
          }
          this.state = 43;
          this._errHandler.sync(this);
          _alt = this.interpreter.adaptivePredict(this._input, 1, this._ctx);
        }
      }
    } catch (re) {
      if (re instanceof RecognitionException) {
        _localctx.exception = re;
        this._errHandler.reportError(this, re);
        this._errHandler.recover(this, re);
      } else {
        throw re;
      }
    } finally {
      this.unrollRecursionContexts(_parentctx);
    }
    return _localctx;
  }
  // @RuleVersion(0)
  public comparisonExpression(): ComparisonExpressionContext {
    let _localctx: ComparisonExpressionContext = new ComparisonExpressionContext(
      this._ctx,
      this.state
    );
    this.enterRule(_localctx, 4, QueryParser.RULE_comparisonExpression);
    try {
      _localctx = new FieldComparisonContext(_localctx);
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 44;
        this.field();
        this.state = 45;
        this.operator();
        this.state = 47;
        this._errHandler.sync(this);
        switch (this.interpreter.adaptivePredict(this._input, 2, this._ctx)) {
          case 1:
            {
              this.state = 46;
              this.value();
            }
            break;
        }
      }
    } catch (re) {
      if (re instanceof RecognitionException) {
        _localctx.exception = re;
        this._errHandler.reportError(this, re);
        this._errHandler.recover(this, re);
      } else {
        throw re;
      }
    } finally {
      this.exitRule();
    }
    return _localctx;
  }
  // @RuleVersion(0)
  public binaryOperator(): BinaryOperatorContext {
    const _localctx: BinaryOperatorContext = new BinaryOperatorContext(this._ctx, this.state);
    this.enterRule(_localctx, 6, QueryParser.RULE_binaryOperator);
    let _la: number;
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 49;
        _la = this._input.LA(1);
        if (!(_la === QueryParser.AND || _la === QueryParser.OR)) {
          this._errHandler.recoverInline(this);
        } else {
          if (this._input.LA(1) === Token.EOF) {
            this.matchedEOF = true;
          }

          this._errHandler.reportMatch(this);
          this.consume();
        }
      }
    } catch (re) {
      if (re instanceof RecognitionException) {
        _localctx.exception = re;
        this._errHandler.reportError(this, re);
        this._errHandler.recover(this, re);
      } else {
        throw re;
      }
    } finally {
      this.exitRule();
    }
    return _localctx;
  }
  // @RuleVersion(0)
  public field(): FieldContext {
    const _localctx: FieldContext = new FieldContext(this._ctx, this.state);
    this.enterRule(_localctx, 8, QueryParser.RULE_field);
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 51;
        this.match(QueryParser.FIELD);
      }
    } catch (re) {
      if (re instanceof RecognitionException) {
        _localctx.exception = re;
        this._errHandler.reportError(this, re);
        this._errHandler.recover(this, re);
      } else {
        throw re;
      }
    } finally {
      this.exitRule();
    }
    return _localctx;
  }
  // @RuleVersion(0)
  public operator(): OperatorContext {
    const _localctx: OperatorContext = new OperatorContext(this._ctx, this.state);
    this.enterRule(_localctx, 10, QueryParser.RULE_operator);
    let _la: number;
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 53;
        _la = this._input.LA(1);
        if (
          !(
            (_la & ~0x1f) === 0 &&
            ((1 << _la) &
              ((1 << QueryParser.EQUAL) |
                (1 << QueryParser.NOT_EQUAL) |
                (1 << QueryParser.GT) |
                (1 << QueryParser.GTE) |
                (1 << QueryParser.LT) |
                (1 << QueryParser.LTE) |
                (1 << QueryParser.LIKE) |
                (1 << QueryParser.IN) |
                (1 << QueryParser.NOT_LIKE) |
                (1 << QueryParser.NOT_IN) |
                (1 << QueryParser.IS_NULL) |
                (1 << QueryParser.IS_NOT_NULL) |
                (1 << QueryParser.NOT_EQUAL2))) !==
              0
          )
        ) {
          this._errHandler.recoverInline(this);
        } else {
          if (this._input.LA(1) === Token.EOF) {
            this.matchedEOF = true;
          }

          this._errHandler.reportMatch(this);
          this.consume();
        }
      }
    } catch (re) {
      if (re instanceof RecognitionException) {
        _localctx.exception = re;
        this._errHandler.reportError(this, re);
        this._errHandler.recover(this, re);
      } else {
        throw re;
      }
    } finally {
      this.exitRule();
    }
    return _localctx;
  }
  // @RuleVersion(0)
  public value(): ValueContext {
    const _localctx: ValueContext = new ValueContext(this._ctx, this.state);
    this.enterRule(_localctx, 12, QueryParser.RULE_value);
    let _la: number;
    try {
      this.state = 68;
      this._errHandler.sync(this);
      switch (this._input.LA(1)) {
        case QueryParser.SINGLEQ_STRING_LITERAL:
        case QueryParser.DOUBLEQ_STRING_LITERAL:
        case QueryParser.INTEGER_LITERAL:
        case QueryParser.NUMERIC_LITERAL:
        case QueryParser.TRUE:
        case QueryParser.FALSE:
        case QueryParser.NULL:
          this.enterOuterAlt(_localctx, 1);
          {
            this.state = 55;
            this.literal();
          }
          break;
        case QueryParser.OPEN_PAREN:
          this.enterOuterAlt(_localctx, 2);
          {
            this.state = 56;
            this.match(QueryParser.OPEN_PAREN);
            this.state = 65;
            this._errHandler.sync(this);
            _la = this._input.LA(1);
            if (
              (_la & ~0x1f) === 0 &&
              ((1 << _la) &
                ((1 << QueryParser.SINGLEQ_STRING_LITERAL) |
                  (1 << QueryParser.DOUBLEQ_STRING_LITERAL) |
                  (1 << QueryParser.INTEGER_LITERAL) |
                  (1 << QueryParser.NUMERIC_LITERAL) |
                  (1 << QueryParser.TRUE) |
                  (1 << QueryParser.FALSE) |
                  (1 << QueryParser.NULL))) !==
                0
            ) {
              {
                this.state = 57;
                this.literal();
                this.state = 62;
                this._errHandler.sync(this);
                _la = this._input.LA(1);
                while (_la === QueryParser.COMMA) {
                  {
                    {
                      this.state = 58;
                      this.match(QueryParser.COMMA);
                      this.state = 59;
                      this.literal();
                    }
                  }
                  this.state = 64;
                  this._errHandler.sync(this);
                  _la = this._input.LA(1);
                }
              }
            }

            this.state = 67;
            this.match(QueryParser.CLOSE_PAREN);
          }
          break;
        default:
          throw new NoViableAltException(this);
      }
    } catch (re) {
      if (re instanceof RecognitionException) {
        _localctx.exception = re;
        this._errHandler.reportError(this, re);
        this._errHandler.recover(this, re);
      } else {
        throw re;
      }
    } finally {
      this.exitRule();
    }
    return _localctx;
  }
  // @RuleVersion(0)
  public literal(): LiteralContext {
    const _localctx: LiteralContext = new LiteralContext(this._ctx, this.state);
    this.enterRule(_localctx, 14, QueryParser.RULE_literal);
    try {
      this.state = 74;
      this._errHandler.sync(this);
      switch (this._input.LA(1)) {
        case QueryParser.SINGLEQ_STRING_LITERAL:
        case QueryParser.DOUBLEQ_STRING_LITERAL:
          this.enterOuterAlt(_localctx, 1);
          {
            this.state = 70;
            this.stringLiteral();
          }
          break;
        case QueryParser.INTEGER_LITERAL:
        case QueryParser.NUMERIC_LITERAL:
          this.enterOuterAlt(_localctx, 2);
          {
            this.state = 71;
            this.numberLiteral();
          }
          break;
        case QueryParser.TRUE:
        case QueryParser.FALSE:
          this.enterOuterAlt(_localctx, 3);
          {
            this.state = 72;
            this.booleanLiteral();
          }
          break;
        case QueryParser.NULL:
          this.enterOuterAlt(_localctx, 4);
          {
            this.state = 73;
            this.nullLiteral();
          }
          break;
        default:
          throw new NoViableAltException(this);
      }
    } catch (re) {
      if (re instanceof RecognitionException) {
        _localctx.exception = re;
        this._errHandler.reportError(this, re);
        this._errHandler.recover(this, re);
      } else {
        throw re;
      }
    } finally {
      this.exitRule();
    }
    return _localctx;
  }
  // @RuleVersion(0)
  public stringLiteral(): StringLiteralContext {
    const _localctx: StringLiteralContext = new StringLiteralContext(this._ctx, this.state);
    this.enterRule(_localctx, 16, QueryParser.RULE_stringLiteral);
    let _la: number;
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 76;
        _la = this._input.LA(1);
        if (
          !(
            _la === QueryParser.SINGLEQ_STRING_LITERAL || _la === QueryParser.DOUBLEQ_STRING_LITERAL
          )
        ) {
          this._errHandler.recoverInline(this);
        } else {
          if (this._input.LA(1) === Token.EOF) {
            this.matchedEOF = true;
          }

          this._errHandler.reportMatch(this);
          this.consume();
        }
      }
    } catch (re) {
      if (re instanceof RecognitionException) {
        _localctx.exception = re;
        this._errHandler.reportError(this, re);
        this._errHandler.recover(this, re);
      } else {
        throw re;
      }
    } finally {
      this.exitRule();
    }
    return _localctx;
  }
  // @RuleVersion(0)
  public numberLiteral(): NumberLiteralContext {
    const _localctx: NumberLiteralContext = new NumberLiteralContext(this._ctx, this.state);
    this.enterRule(_localctx, 18, QueryParser.RULE_numberLiteral);
    let _la: number;
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 78;
        _la = this._input.LA(1);
        if (!(_la === QueryParser.INTEGER_LITERAL || _la === QueryParser.NUMERIC_LITERAL)) {
          this._errHandler.recoverInline(this);
        } else {
          if (this._input.LA(1) === Token.EOF) {
            this.matchedEOF = true;
          }

          this._errHandler.reportMatch(this);
          this.consume();
        }
      }
    } catch (re) {
      if (re instanceof RecognitionException) {
        _localctx.exception = re;
        this._errHandler.reportError(this, re);
        this._errHandler.recover(this, re);
      } else {
        throw re;
      }
    } finally {
      this.exitRule();
    }
    return _localctx;
  }
  // @RuleVersion(0)
  public booleanLiteral(): BooleanLiteralContext {
    const _localctx: BooleanLiteralContext = new BooleanLiteralContext(this._ctx, this.state);
    this.enterRule(_localctx, 20, QueryParser.RULE_booleanLiteral);
    let _la: number;
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 80;
        _la = this._input.LA(1);
        if (!(_la === QueryParser.TRUE || _la === QueryParser.FALSE)) {
          this._errHandler.recoverInline(this);
        } else {
          if (this._input.LA(1) === Token.EOF) {
            this.matchedEOF = true;
          }

          this._errHandler.reportMatch(this);
          this.consume();
        }
      }
    } catch (re) {
      if (re instanceof RecognitionException) {
        _localctx.exception = re;
        this._errHandler.reportError(this, re);
        this._errHandler.recover(this, re);
      } else {
        throw re;
      }
    } finally {
      this.exitRule();
    }
    return _localctx;
  }
  // @RuleVersion(0)
  public nullLiteral(): NullLiteralContext {
    const _localctx: NullLiteralContext = new NullLiteralContext(this._ctx, this.state);
    this.enterRule(_localctx, 22, QueryParser.RULE_nullLiteral);
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 82;
        this.match(QueryParser.NULL);
      }
    } catch (re) {
      if (re instanceof RecognitionException) {
        _localctx.exception = re;
        this._errHandler.reportError(this, re);
        this._errHandler.recover(this, re);
      } else {
        throw re;
      }
    } finally {
      this.exitRule();
    }
    return _localctx;
  }

  public sempred(_localctx: RuleContext, ruleIndex: number, predIndex: number): boolean {
    switch (ruleIndex) {
      case 1:
        return this.expression_sempred(_localctx as ExpressionContext, predIndex);
    }
    return true;
  }
  private expression_sempred(_localctx: ExpressionContext, predIndex: number): boolean {
    switch (predIndex) {
      case 0:
        return this.precpred(this._ctx, 2);
    }
    return true;
  }

  public static readonly _serializedATN: string =
    '\x03\uC91D\uCABA\u058D\uAFBA\u4F53\u0607\uEA8B\uC241\x03!W\x04\x02\t\x02' +
    '\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04\x07\t\x07' +
    '\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r\t\r\x03\x02\x03' +
    '\x02\x03\x02\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x05\x03$' +
    '\n\x03\x03\x03\x03\x03\x03\x03\x03\x03\x07\x03*\n\x03\f\x03\x0E\x03-\v' +
    '\x03\x03\x04\x03\x04\x03\x04\x05\x042\n\x04\x03\x05\x03\x05\x03\x06\x03' +
    '\x06\x03\x07\x03\x07\x03\b\x03\b\x03\b\x03\b\x03\b\x07\b?\n\b\f\b\x0E' +
    '\bB\v\b\x05\bD\n\b\x03\b\x05\bG\n\b\x03\t\x03\t\x03\t\x03\t\x05\tM\n\t' +
    '\x03\n\x03\n\x03\v\x03\v\x03\f\x03\f\x03\r\x03\r\x03\r\x02\x02\x03\x04' +
    '\x0E\x02\x02\x04\x02\x06\x02\b\x02\n\x02\f\x02\x0E\x02\x10\x02\x12\x02' +
    '\x14\x02\x16\x02\x18\x02\x02\x07\x03\x02\x12\x13\x04\x02\x14\x1F!!\x03' +
    '\x02\v\f\x03\x02\r\x0E\x03\x02\x0F\x10\x02S\x02\x1A\x03\x02\x02\x02\x04' +
    '#\x03\x02\x02\x02\x06.\x03\x02\x02\x02\b3\x03\x02\x02\x02\n5\x03\x02\x02' +
    '\x02\f7\x03\x02\x02\x02\x0EF\x03\x02\x02\x02\x10L\x03\x02\x02\x02\x12' +
    'N\x03\x02\x02\x02\x14P\x03\x02\x02\x02\x16R\x03\x02\x02\x02\x18T\x03\x02' +
    '\x02\x02\x1A\x1B\x05\x04\x03\x02\x1B\x1C\x07\x02\x02\x03\x1C\x03\x03\x02' +
    '\x02\x02\x1D\x1E\b\x03\x01\x02\x1E\x1F\x07\x04\x02\x02\x1F \x05\x04\x03' +
    '\x02 !\x07\x05\x02\x02!$\x03\x02\x02\x02"$\x05\x06\x04\x02#\x1D\x03\x02' +
    '\x02\x02#"\x03\x02\x02\x02$+\x03\x02\x02\x02%&\f\x04\x02\x02&\'\x05\b' +
    "\x05\x02'(\x05\x04\x03\x05(*\x03\x02\x02\x02)%\x03\x02\x02\x02*-\x03" +
    '\x02\x02\x02+)\x03\x02\x02\x02+,\x03\x02\x02\x02,\x05\x03\x02\x02\x02' +
    '-+\x03\x02\x02\x02./\x05\n\x06\x02/1\x05\f\x07\x0202\x05\x0E\b\x0210\x03' +
    '\x02\x02\x0212\x03\x02\x02\x022\x07\x03\x02\x02\x0234\t\x02\x02\x024\t' +
    '\x03\x02\x02\x0256\x07\n\x02\x026\v\x03\x02\x02\x0278\t\x03\x02\x028\r' +
    '\x03\x02\x02\x029G\x05\x10\t\x02:C\x07\x04\x02\x02;@\x05\x10\t\x02<=\x07' +
    '\x03\x02\x02=?\x05\x10\t\x02><\x03\x02\x02\x02?B\x03\x02\x02\x02@>\x03' +
    '\x02\x02\x02@A\x03\x02\x02\x02AD\x03\x02\x02\x02B@\x03\x02\x02\x02C;\x03' +
    '\x02\x02\x02CD\x03\x02\x02\x02DE\x03\x02\x02\x02EG\x07\x05\x02\x02F9\x03' +
    '\x02\x02\x02F:\x03\x02\x02\x02G\x0F\x03\x02\x02\x02HM\x05\x12\n\x02IM' +
    '\x05\x14\v\x02JM\x05\x16\f\x02KM\x05\x18\r\x02LH\x03\x02\x02\x02LI\x03' +
    '\x02\x02\x02LJ\x03\x02\x02\x02LK\x03\x02\x02\x02M\x11\x03\x02\x02\x02' +
    'NO\t\x04\x02\x02O\x13\x03\x02\x02\x02PQ\t\x05\x02\x02Q\x15\x03\x02\x02' +
    '\x02RS\t\x06\x02\x02S\x17\x03\x02\x02\x02TU\x07\x11\x02\x02U\x19\x03\x02' +
    '\x02\x02\t#+1@CFL';
  public static __ATN: ATN;
  public static get _ATN(): ATN {
    if (!QueryParser.__ATN) {
      QueryParser.__ATN = new ATNDeserializer().deserialize(
        Utils.toCharArray(QueryParser._serializedATN)
      );
    }

    return QueryParser.__ATN;
  }
}

export class StartContext extends ParserRuleContext {
  public expression(): ExpressionContext {
    return this.getRuleContext(0, ExpressionContext);
  }
  public EOF(): TerminalNode {
    return this.getToken(QueryParser.EOF, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return QueryParser.RULE_start;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitStart) {
      return visitor.visitStart(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class ExpressionContext extends ParserRuleContext {
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return QueryParser.RULE_expression;
  }
  public copyFrom(ctx: ExpressionContext): void {
    super.copyFrom(ctx);
  }
}
export class ParenExpressionContext extends ExpressionContext {
  public OPEN_PAREN(): TerminalNode {
    return this.getToken(QueryParser.OPEN_PAREN, 0);
  }
  public expression(): ExpressionContext {
    return this.getRuleContext(0, ExpressionContext);
  }
  public CLOSE_PAREN(): TerminalNode {
    return this.getToken(QueryParser.CLOSE_PAREN, 0);
  }
  constructor(ctx: ExpressionContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitParenExpression) {
      return visitor.visitParenExpression(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}
export class BinaryExpressionContext extends ExpressionContext {
  public expression(): ExpressionContext[];
  public expression(i: number): ExpressionContext;
  public expression(i?: number): ExpressionContext | ExpressionContext[] {
    if (i === undefined) {
      return this.getRuleContexts(ExpressionContext);
    } else {
      return this.getRuleContext(i, ExpressionContext);
    }
  }
  public binaryOperator(): BinaryOperatorContext {
    return this.getRuleContext(0, BinaryOperatorContext);
  }
  constructor(ctx: ExpressionContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitBinaryExpression) {
      return visitor.visitBinaryExpression(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}
export class SimpleComparisonContext extends ExpressionContext {
  public comparisonExpression(): ComparisonExpressionContext {
    return this.getRuleContext(0, ComparisonExpressionContext);
  }
  constructor(ctx: ExpressionContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitSimpleComparison) {
      return visitor.visitSimpleComparison(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class ComparisonExpressionContext extends ParserRuleContext {
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return QueryParser.RULE_comparisonExpression;
  }
  public copyFrom(ctx: ComparisonExpressionContext): void {
    super.copyFrom(ctx);
  }
}
export class FieldComparisonContext extends ComparisonExpressionContext {
  public field(): FieldContext {
    return this.getRuleContext(0, FieldContext);
  }
  public operator(): OperatorContext {
    return this.getRuleContext(0, OperatorContext);
  }
  public value(): ValueContext | undefined {
    return this.tryGetRuleContext(0, ValueContext);
  }
  constructor(ctx: ComparisonExpressionContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitFieldComparison) {
      return visitor.visitFieldComparison(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class BinaryOperatorContext extends ParserRuleContext {
  public AND(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.AND, 0);
  }
  public OR(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.OR, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return QueryParser.RULE_binaryOperator;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitBinaryOperator) {
      return visitor.visitBinaryOperator(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class FieldContext extends ParserRuleContext {
  public FIELD(): TerminalNode {
    return this.getToken(QueryParser.FIELD, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return QueryParser.RULE_field;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitField) {
      return visitor.visitField(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class OperatorContext extends ParserRuleContext {
  public EQUAL(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.EQUAL, 0);
  }
  public NOT_EQUAL(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.NOT_EQUAL, 0);
  }
  public NOT_EQUAL2(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.NOT_EQUAL2, 0);
  }
  public GT(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.GT, 0);
  }
  public GTE(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.GTE, 0);
  }
  public LT(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.LT, 0);
  }
  public LTE(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.LTE, 0);
  }
  public LIKE(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.LIKE, 0);
  }
  public IN(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.IN, 0);
  }
  public NOT_LIKE(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.NOT_LIKE, 0);
  }
  public NOT_IN(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.NOT_IN, 0);
  }
  public IS_NULL(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.IS_NULL, 0);
  }
  public IS_NOT_NULL(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.IS_NOT_NULL, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return QueryParser.RULE_operator;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitOperator) {
      return visitor.visitOperator(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class ValueContext extends ParserRuleContext {
  public literal(): LiteralContext[];
  public literal(i: number): LiteralContext;
  public literal(i?: number): LiteralContext | LiteralContext[] {
    if (i === undefined) {
      return this.getRuleContexts(LiteralContext);
    } else {
      return this.getRuleContext(i, LiteralContext);
    }
  }
  public OPEN_PAREN(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.OPEN_PAREN, 0);
  }
  public CLOSE_PAREN(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.CLOSE_PAREN, 0);
  }
  public COMMA(): TerminalNode[];
  public COMMA(i: number): TerminalNode;
  public COMMA(i?: number): TerminalNode | TerminalNode[] {
    if (i === undefined) {
      return this.getTokens(QueryParser.COMMA);
    } else {
      return this.getToken(QueryParser.COMMA, i);
    }
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return QueryParser.RULE_value;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitValue) {
      return visitor.visitValue(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class LiteralContext extends ParserRuleContext {
  public stringLiteral(): StringLiteralContext | undefined {
    return this.tryGetRuleContext(0, StringLiteralContext);
  }
  public numberLiteral(): NumberLiteralContext | undefined {
    return this.tryGetRuleContext(0, NumberLiteralContext);
  }
  public booleanLiteral(): BooleanLiteralContext | undefined {
    return this.tryGetRuleContext(0, BooleanLiteralContext);
  }
  public nullLiteral(): NullLiteralContext | undefined {
    return this.tryGetRuleContext(0, NullLiteralContext);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return QueryParser.RULE_literal;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitLiteral) {
      return visitor.visitLiteral(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class StringLiteralContext extends ParserRuleContext {
  public SINGLEQ_STRING_LITERAL(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.SINGLEQ_STRING_LITERAL, 0);
  }
  public DOUBLEQ_STRING_LITERAL(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.DOUBLEQ_STRING_LITERAL, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return QueryParser.RULE_stringLiteral;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitStringLiteral) {
      return visitor.visitStringLiteral(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class NumberLiteralContext extends ParserRuleContext {
  public INTEGER_LITERAL(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.INTEGER_LITERAL, 0);
  }
  public NUMERIC_LITERAL(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.NUMERIC_LITERAL, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return QueryParser.RULE_numberLiteral;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitNumberLiteral) {
      return visitor.visitNumberLiteral(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class BooleanLiteralContext extends ParserRuleContext {
  public TRUE(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.TRUE, 0);
  }
  public FALSE(): TerminalNode | undefined {
    return this.tryGetToken(QueryParser.FALSE, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return QueryParser.RULE_booleanLiteral;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitBooleanLiteral) {
      return visitor.visitBooleanLiteral(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class NullLiteralContext extends ParserRuleContext {
  public NULL(): TerminalNode {
    return this.getToken(QueryParser.NULL, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return QueryParser.RULE_nullLiteral;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitNullLiteral) {
      return visitor.visitNullLiteral(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}
