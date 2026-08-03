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

export class Query extends Parser {
  public static readonly COMMA = 1;
  public static readonly OPEN_PAREN = 2;
  public static readonly CLOSE_PAREN = 3;
  public static readonly OPEN_BRACKET = 4;
  public static readonly CLOSE_BRACKET = 5;
  public static readonly L_CURLY = 6;
  public static readonly R_CURLY = 7;
  public static readonly SIMPLE_IDENTIFIER = 8;
  public static readonly SINGLEQ_STRING_LITERAL = 9;
  public static readonly DOUBLEQ_STRING_LITERAL = 10;
  public static readonly INTEGER_LITERAL = 11;
  public static readonly NUMERIC_LITERAL = 12;
  public static readonly EQUAL_OPERATOR = 13;
  public static readonly NOT_EQUAL_OPERATOR = 14;
  public static readonly GT_OPERATOR = 15;
  public static readonly GTE_OPERATOR = 16;
  public static readonly LT_OPERATOR = 17;
  public static readonly LTE_OPERATOR = 18;
  public static readonly TRUE_SYMBOL = 19;
  public static readonly FALSE_SYMBOL = 20;
  public static readonly AND_SYMBOL = 21;
  public static readonly OR_SYMBOL = 22;
  public static readonly NOT_SYMBOL = 23;
  public static readonly NULL_SYMBOL = 24;
  public static readonly IS_SYMBOL = 25;
  public static readonly LS_NULL_SYMBOL = 26;
  public static readonly LS_NOT_NULL_SYMBOL = 27;
  public static readonly LIKE_SYMBOL = 28;
  public static readonly IN_SYMBOL = 29;
  public static readonly HAS_SYMBOL = 30;
  public static readonly NOT_LIKE_SYMBOL = 31;
  public static readonly NOT_IN_SYMBOL = 32;
  public static readonly WHITESPACE = 33;
  public static readonly NOT_EQUAL2_OPERATOR = 34;
  public static readonly RULE_start = 0;
  public static readonly RULE_expr = 1;
  public static readonly RULE_queryStatement = 2;
  public static readonly RULE_predicate = 3;
  public static readonly RULE_fieldIdentifier = 4;
  public static readonly RULE_compOp = 5;
  public static readonly RULE_isOp = 6;
  public static readonly RULE_likeOp = 7;
  public static readonly RULE_inOp = 8;
  public static readonly RULE_value = 9;
  public static readonly RULE_valueList = 10;
  public static readonly RULE_literal = 11;
  public static readonly RULE_stringLiteral = 12;
  public static readonly RULE_numberLiteral = 13;
  public static readonly RULE_booleanLiteral = 14;
  public static readonly RULE_nullLiteral = 15;
  public static readonly ruleNames: string[] = [
    'start',
    'expr',
    'queryStatement',
    'predicate',
    'fieldIdentifier',
    'compOp',
    'isOp',
    'likeOp',
    'inOp',
    'value',
    'valueList',
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
    undefined,
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
    'SIMPLE_IDENTIFIER',
    'SINGLEQ_STRING_LITERAL',
    'DOUBLEQ_STRING_LITERAL',
    'INTEGER_LITERAL',
    'NUMERIC_LITERAL',
    'EQUAL_OPERATOR',
    'NOT_EQUAL_OPERATOR',
    'GT_OPERATOR',
    'GTE_OPERATOR',
    'LT_OPERATOR',
    'LTE_OPERATOR',
    'TRUE_SYMBOL',
    'FALSE_SYMBOL',
    'AND_SYMBOL',
    'OR_SYMBOL',
    'NOT_SYMBOL',
    'NULL_SYMBOL',
    'IS_SYMBOL',
    'LS_NULL_SYMBOL',
    'LS_NOT_NULL_SYMBOL',
    'LIKE_SYMBOL',
    'IN_SYMBOL',
    'HAS_SYMBOL',
    'NOT_LIKE_SYMBOL',
    'NOT_IN_SYMBOL',
    'WHITESPACE',
    'NOT_EQUAL2_OPERATOR',
  ];
  public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(
    Query._LITERAL_NAMES,
    Query._SYMBOLIC_NAMES,
    []
  );

  // @Override
  // @NotNull
  public get vocabulary(): Vocabulary {
    return Query.VOCABULARY;
  }

  // @Override
  public get grammarFileName(): string {
    return 'Query.g4';
  }

  // @Override
  public get ruleNames(): string[] {
    return Query.ruleNames;
  }

  // @Override
  public get serializedATN(): string {
    return Query._serializedATN;
  }

  protected createFailedPredicateException(
    predicate?: string,
    message?: string
  ): FailedPredicateException {
    return new FailedPredicateException(this, predicate, message);
  }

  constructor(input: TokenStream) {
    super(input);
    this._interp = new ParserATNSimulator(Query._ATN, this);
  }
  // @RuleVersion(0)
  public start(): StartContext {
    const _localctx: StartContext = new StartContext(this._ctx, this.state);
    this.enterRule(_localctx, 0, Query.RULE_start);
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 32;
        this.expr(0);
        this.state = 33;
        this.match(Query.EOF);
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

  public expr(): ExprContext;
  public expr(_p: number): ExprContext;
  // @RuleVersion(0)
  public expr(_p?: number): ExprContext {
    if (_p === undefined) {
      _p = 0;
    }

    const _parentctx: ParserRuleContext = this._ctx;
    const _parentState: number = this.state;
    let _localctx: ExprContext = new ExprContext(this._ctx, _parentState);
    let _prevctx: ExprContext = _localctx;
    const _startState = 2;
    this.enterRecursionRule(_localctx, 2, Query.RULE_expr, _p);
    let _la: number;
    try {
      let _alt: number;
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 41;
        this._errHandler.sync(this);
        switch (this._input.LA(1)) {
          case Query.SIMPLE_IDENTIFIER:
            {
              _localctx = new QueryExprContext(_localctx);
              this._ctx = _localctx;
              _prevctx = _localctx;

              this.state = 36;
              this.queryStatement();
            }
            break;
          case Query.OPEN_PAREN:
            {
              _localctx = new ParenQueryExprContext(_localctx);
              this._ctx = _localctx;
              _prevctx = _localctx;
              this.state = 37;
              this.match(Query.OPEN_PAREN);
              this.state = 38;
              this.expr(0);
              this.state = 39;
              this.match(Query.CLOSE_PAREN);
            }
            break;
          default:
            throw new NoViableAltException(this);
        }
        this._ctx._stop = this._input.tryLT(-1);
        this.state = 48;
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
                _localctx = new BinaryExprContext(new ExprContext(_parentctx, _parentState));
                this.pushNewRecursionContext(_localctx, _startState, Query.RULE_expr);
                this.state = 43;
                if (!this.precpred(this._ctx, 2)) {
                  throw this.createFailedPredicateException('this.precpred(this._ctx, 2)');
                }
                this.state = 44;
                (_localctx as BinaryExprContext)._op = this._input.LT(1);
                _la = this._input.LA(1);
                if (!(_la === Query.AND_SYMBOL || _la === Query.OR_SYMBOL)) {
                  (_localctx as BinaryExprContext)._op = this._errHandler.recoverInline(this);
                } else {
                  if (this._input.LA(1) === Token.EOF) {
                    this.matchedEOF = true;
                  }

                  this._errHandler.reportMatch(this);
                  this.consume();
                }
                this.state = 45;
                this.expr(3);
              }
            }
          }
          this.state = 50;
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
  public queryStatement(): QueryStatementContext {
    let _localctx: QueryStatementContext = new QueryStatementContext(this._ctx, this.state);
    this.enterRule(_localctx, 4, Query.RULE_queryStatement);
    try {
      this.state = 59;
      this._errHandler.sync(this);
      switch (this.interpreter.adaptivePredict(this._input, 2, this._ctx)) {
        case 1:
          _localctx = new PrimaryExprPredicateContext(_localctx);
          this.enterOuterAlt(_localctx, 1);
          {
            this.state = 51;
            this.predicate();
          }
          break;

        case 2:
          _localctx = new PrimaryExprIsContext(_localctx);
          this.enterOuterAlt(_localctx, 2);
          {
            this.state = 52;
            this.fieldIdentifier();
            this.state = 53;
            this.isOp();
          }
          break;

        case 3:
          _localctx = new PrimaryExprCompareContext(_localctx);
          this.enterOuterAlt(_localctx, 3);
          {
            this.state = 55;
            this.fieldIdentifier();
            this.state = 56;
            this.compOp();
            this.state = 57;
            this.value();
          }
          break;
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
  public predicate(): PredicateContext {
    let _localctx: PredicateContext = new PredicateContext(this._ctx, this.state);
    this.enterRule(_localctx, 6, Query.RULE_predicate);
    try {
      this.state = 77;
      this._errHandler.sync(this);
      switch (this.interpreter.adaptivePredict(this._input, 3, this._ctx)) {
        case 1:
          _localctx = new PredicateExprLikeContext(_localctx);
          this.enterOuterAlt(_localctx, 1);
          {
            this.state = 61;
            this.fieldIdentifier();
            this.state = 62;
            this.likeOp();
            this.state = 63;
            this.value();
          }
          break;

        case 2:
          _localctx = new PredicateExprInContext(_localctx);
          this.enterOuterAlt(_localctx, 2);
          {
            this.state = 65;
            this.fieldIdentifier();
            this.state = 66;
            this.inOp();
            this.state = 67;
            this.valueList();
          }
          break;

        case 3:
          _localctx = new PredicateExprHasContext(_localctx);
          this.enterOuterAlt(_localctx, 3);
          {
            this.state = 69;
            this.fieldIdentifier();
            this.state = 70;
            this.match(Query.HAS_SYMBOL);
            this.state = 71;
            this.valueList();
          }
          break;

        case 4:
          _localctx = new PredicateExprEqArrayContext(_localctx);
          this.enterOuterAlt(_localctx, 4);
          {
            this.state = 73;
            this.fieldIdentifier();
            this.state = 74;
            this.match(Query.EQUAL_OPERATOR);
            this.state = 75;
            this.valueList();
          }
          break;
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
  public fieldIdentifier(): FieldIdentifierContext {
    const _localctx: FieldIdentifierContext = new FieldIdentifierContext(this._ctx, this.state);
    this.enterRule(_localctx, 8, Query.RULE_fieldIdentifier);
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 79;
        this.match(Query.SIMPLE_IDENTIFIER);
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
  public compOp(): CompOpContext {
    const _localctx: CompOpContext = new CompOpContext(this._ctx, this.state);
    this.enterRule(_localctx, 10, Query.RULE_compOp);
    let _la: number;
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 81;
        _la = this._input.LA(1);
        if (
          !(
            ((_la - 13) & ~0x1f) === 0 &&
            ((1 << (_la - 13)) &
              ((1 << (Query.EQUAL_OPERATOR - 13)) |
                (1 << (Query.NOT_EQUAL_OPERATOR - 13)) |
                (1 << (Query.GT_OPERATOR - 13)) |
                (1 << (Query.GTE_OPERATOR - 13)) |
                (1 << (Query.LT_OPERATOR - 13)) |
                (1 << (Query.LTE_OPERATOR - 13)) |
                (1 << (Query.NOT_EQUAL2_OPERATOR - 13)))) !==
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
  public isOp(): IsOpContext {
    const _localctx: IsOpContext = new IsOpContext(this._ctx, this.state);
    this.enterRule(_localctx, 12, Query.RULE_isOp);
    let _la: number;
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 83;
        _la = this._input.LA(1);
        if (!(_la === Query.LS_NULL_SYMBOL || _la === Query.LS_NOT_NULL_SYMBOL)) {
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
  public likeOp(): LikeOpContext {
    const _localctx: LikeOpContext = new LikeOpContext(this._ctx, this.state);
    this.enterRule(_localctx, 14, Query.RULE_likeOp);
    let _la: number;
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 85;
        _la = this._input.LA(1);
        if (!(_la === Query.LIKE_SYMBOL || _la === Query.NOT_LIKE_SYMBOL)) {
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
  public inOp(): InOpContext {
    const _localctx: InOpContext = new InOpContext(this._ctx, this.state);
    this.enterRule(_localctx, 16, Query.RULE_inOp);
    let _la: number;
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 87;
        _la = this._input.LA(1);
        if (!(_la === Query.IN_SYMBOL || _la === Query.NOT_IN_SYMBOL)) {
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
    this.enterRule(_localctx, 18, Query.RULE_value);
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 89;
        this.literal();
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
  public valueList(): ValueListContext {
    const _localctx: ValueListContext = new ValueListContext(this._ctx, this.state);
    this.enterRule(_localctx, 20, Query.RULE_valueList);
    let _la: number;
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 91;
        this.match(Query.OPEN_PAREN);
        this.state = 100;
        this._errHandler.sync(this);
        _la = this._input.LA(1);
        if (
          (_la & ~0x1f) === 0 &&
          ((1 << _la) &
            ((1 << Query.SINGLEQ_STRING_LITERAL) |
              (1 << Query.DOUBLEQ_STRING_LITERAL) |
              (1 << Query.INTEGER_LITERAL) |
              (1 << Query.NUMERIC_LITERAL) |
              (1 << Query.TRUE_SYMBOL) |
              (1 << Query.FALSE_SYMBOL) |
              (1 << Query.NULL_SYMBOL))) !==
            0
        ) {
          {
            this.state = 92;
            this.literal();
            this.state = 97;
            this._errHandler.sync(this);
            _la = this._input.LA(1);
            while (_la === Query.COMMA) {
              {
                {
                  this.state = 93;
                  this.match(Query.COMMA);
                  this.state = 94;
                  this.literal();
                }
              }
              this.state = 99;
              this._errHandler.sync(this);
              _la = this._input.LA(1);
            }
          }
        }

        this.state = 102;
        this.match(Query.CLOSE_PAREN);
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
    this.enterRule(_localctx, 22, Query.RULE_literal);
    try {
      this.state = 108;
      this._errHandler.sync(this);
      switch (this._input.LA(1)) {
        case Query.SINGLEQ_STRING_LITERAL:
        case Query.DOUBLEQ_STRING_LITERAL:
          this.enterOuterAlt(_localctx, 1);
          {
            this.state = 104;
            this.stringLiteral();
          }
          break;
        case Query.INTEGER_LITERAL:
        case Query.NUMERIC_LITERAL:
          this.enterOuterAlt(_localctx, 2);
          {
            this.state = 105;
            this.numberLiteral();
          }
          break;
        case Query.TRUE_SYMBOL:
        case Query.FALSE_SYMBOL:
          this.enterOuterAlt(_localctx, 3);
          {
            this.state = 106;
            this.booleanLiteral();
          }
          break;
        case Query.NULL_SYMBOL:
          this.enterOuterAlt(_localctx, 4);
          {
            this.state = 107;
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
    this.enterRule(_localctx, 24, Query.RULE_stringLiteral);
    let _la: number;
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 110;
        _la = this._input.LA(1);
        if (!(_la === Query.SINGLEQ_STRING_LITERAL || _la === Query.DOUBLEQ_STRING_LITERAL)) {
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
    this.enterRule(_localctx, 26, Query.RULE_numberLiteral);
    let _la: number;
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 112;
        _la = this._input.LA(1);
        if (!(_la === Query.INTEGER_LITERAL || _la === Query.NUMERIC_LITERAL)) {
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
    this.enterRule(_localctx, 28, Query.RULE_booleanLiteral);
    let _la: number;
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 114;
        _la = this._input.LA(1);
        if (!(_la === Query.TRUE_SYMBOL || _la === Query.FALSE_SYMBOL)) {
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
    this.enterRule(_localctx, 30, Query.RULE_nullLiteral);
    try {
      this.enterOuterAlt(_localctx, 1);
      {
        this.state = 116;
        this.match(Query.NULL_SYMBOL);
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
        return this.expr_sempred(_localctx as ExprContext, predIndex);
    }
    return true;
  }
  private expr_sempred(_localctx: ExprContext, predIndex: number): boolean {
    switch (predIndex) {
      case 0:
        return this.precpred(this._ctx, 2);
    }
    return true;
  }

  public static readonly _serializedATN: string =
    '\x03\uC91D\uCABA\u058D\uAFBA\u4F53\u0607\uEA8B\uC241\x03$y\x04\x02\t\x02' +
    '\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04\x07\t\x07' +
    '\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r\t\r\x04\x0E\t' +
    '\x0E\x04\x0F\t\x0F\x04\x10\t\x10\x04\x11\t\x11\x03\x02\x03\x02\x03\x02' +
    '\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x05\x03,\n\x03\x03\x03' +
    '\x03\x03\x03\x03\x07\x031\n\x03\f\x03\x0E\x034\v\x03\x03\x04\x03\x04\x03' +
    '\x04\x03\x04\x03\x04\x03\x04\x03\x04\x03\x04\x05\x04>\n\x04\x03\x05\x03' +
    '\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03' +
    '\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x05\x05\x05P\n\x05\x03\x06\x03' +
    '\x06\x03\x07\x03\x07\x03\b\x03\b\x03\t\x03\t\x03\n\x03\n\x03\v\x03\v\x03' +
    '\f\x03\f\x03\f\x03\f\x07\fb\n\f\f\f\x0E\fe\v\f\x05\fg\n\f\x03\f\x03\f' +
    '\x03\r\x03\r\x03\r\x03\r\x05\ro\n\r\x03\x0E\x03\x0E\x03\x0F\x03\x0F\x03' +
    '\x10\x03\x10\x03\x11\x03\x11\x03\x11\x02\x02\x03\x04\x12\x02\x02\x04\x02' +
    '\x06\x02\b\x02\n\x02\f\x02\x0E\x02\x10\x02\x12\x02\x14\x02\x16\x02\x18' +
    '\x02\x1A\x02\x1C\x02\x1E\x02 \x02\x02\n\x03\x02\x17\x18\x04\x02\x0F\x14' +
    '$$\x03\x02\x1C\x1D\x04\x02\x1E\x1E!!\x04\x02\x1F\x1F""\x03\x02\v\f\x03' +
    '\x02\r\x0E\x03\x02\x15\x16\x02t\x02"\x03\x02\x02\x02\x04+\x03\x02\x02' +
    '\x02\x06=\x03\x02\x02\x02\bO\x03\x02\x02\x02\nQ\x03\x02\x02\x02\fS\x03' +
    '\x02\x02\x02\x0EU\x03\x02\x02\x02\x10W\x03\x02\x02\x02\x12Y\x03\x02\x02' +
    '\x02\x14[\x03\x02\x02\x02\x16]\x03\x02\x02\x02\x18n\x03\x02\x02\x02\x1A' +
    'p\x03\x02\x02\x02\x1Cr\x03\x02\x02\x02\x1Et\x03\x02\x02\x02 v\x03\x02' +
    '\x02\x02"#\x05\x04\x03\x02#$\x07\x02\x02\x03$\x03\x03\x02\x02\x02%&\b' +
    "\x03\x01\x02&,\x05\x06\x04\x02'(\x07\x04\x02\x02()\x05\x04\x03\x02)*" +
    "\x07\x05\x02\x02*,\x03\x02\x02\x02+%\x03\x02\x02\x02+'\x03\x02\x02\x02" +
    ',2\x03\x02\x02\x02-.\f\x04\x02\x02./\t\x02\x02\x02/1\x05\x04\x03\x050' +
    '-\x03\x02\x02\x0214\x03\x02\x02\x0220\x03\x02\x02\x0223\x03\x02\x02\x02' +
    '3\x05\x03\x02\x02\x0242\x03\x02\x02\x025>\x05\b\x05\x0267\x05\n\x06\x02' +
    '78\x05\x0E\b\x028>\x03\x02\x02\x029:\x05\n\x06\x02:;\x05\f\x07\x02;<\x05' +
    '\x14\v\x02<>\x03\x02\x02\x02=5\x03\x02\x02\x02=6\x03\x02\x02\x02=9\x03' +
    '\x02\x02\x02>\x07\x03\x02\x02\x02?@\x05\n\x06\x02@A\x05\x10\t\x02AB\x05' +
    '\x14\v\x02BP\x03\x02\x02\x02CD\x05\n\x06\x02DE\x05\x12\n\x02EF\x05\x16' +
    '\f\x02FP\x03\x02\x02\x02GH\x05\n\x06\x02HI\x07 \x02\x02IJ\x05\x16\f\x02' +
    'JP\x03\x02\x02\x02KL\x05\n\x06\x02LM\x07\x0F\x02\x02MN\x05\x16\f\x02N' +
    'P\x03\x02\x02\x02O?\x03\x02\x02\x02OC\x03\x02\x02\x02OG\x03\x02\x02\x02' +
    'OK\x03\x02\x02\x02P\t\x03\x02\x02\x02QR\x07\n\x02\x02R\v\x03\x02\x02\x02' +
    'ST\t\x03\x02\x02T\r\x03\x02\x02\x02UV\t\x04\x02\x02V\x0F\x03\x02\x02\x02' +
    'WX\t\x05\x02\x02X\x11\x03\x02\x02\x02YZ\t\x06\x02\x02Z\x13\x03\x02\x02' +
    '\x02[\\\x05\x18\r\x02\\\x15\x03\x02\x02\x02]f\x07\x04\x02\x02^c\x05\x18' +
    '\r\x02_`\x07\x03\x02\x02`b\x05\x18\r\x02a_\x03\x02\x02\x02be\x03\x02\x02' +
    '\x02ca\x03\x02\x02\x02cd\x03\x02\x02\x02dg\x03\x02\x02\x02ec\x03\x02\x02' +
    '\x02f^\x03\x02\x02\x02fg\x03\x02\x02\x02gh\x03\x02\x02\x02hi\x07\x05\x02' +
    '\x02i\x17\x03\x02\x02\x02jo\x05\x1A\x0E\x02ko\x05\x1C\x0F\x02lo\x05\x1E' +
    '\x10\x02mo\x05 \x11\x02nj\x03\x02\x02\x02nk\x03\x02\x02\x02nl\x03\x02' +
    '\x02\x02nm\x03\x02\x02\x02o\x19\x03\x02\x02\x02pq\t\x07\x02\x02q\x1B\x03' +
    '\x02\x02\x02rs\t\b\x02\x02s\x1D\x03\x02\x02\x02tu\t\t\x02\x02u\x1F\x03' +
    '\x02\x02\x02vw\x07\x1A\x02\x02w!\x03\x02\x02\x02\t+2=Ocfn';
  public static __ATN: ATN;
  public static get _ATN(): ATN {
    if (!Query.__ATN) {
      Query.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(Query._serializedATN));
    }

    return Query.__ATN;
  }
}

export class StartContext extends ParserRuleContext {
  public expr(): ExprContext {
    return this.getRuleContext(0, ExprContext);
  }
  public EOF(): TerminalNode {
    return this.getToken(Query.EOF, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_start;
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

export class ExprContext extends ParserRuleContext {
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_expr;
  }
  public copyFrom(ctx: ExprContext): void {
    super.copyFrom(ctx);
  }
}
export class QueryExprContext extends ExprContext {
  public queryStatement(): QueryStatementContext {
    return this.getRuleContext(0, QueryStatementContext);
  }
  constructor(ctx: ExprContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitQueryExpr) {
      return visitor.visitQueryExpr(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}
export class BinaryExprContext extends ExprContext {
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
  public AND_SYMBOL(): TerminalNode | undefined {
    return this.tryGetToken(Query.AND_SYMBOL, 0);
  }
  public OR_SYMBOL(): TerminalNode | undefined {
    return this.tryGetToken(Query.OR_SYMBOL, 0);
  }
  constructor(ctx: ExprContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitBinaryExpr) {
      return visitor.visitBinaryExpr(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}
export class ParenQueryExprContext extends ExprContext {
  public OPEN_PAREN(): TerminalNode {
    return this.getToken(Query.OPEN_PAREN, 0);
  }
  public expr(): ExprContext {
    return this.getRuleContext(0, ExprContext);
  }
  public CLOSE_PAREN(): TerminalNode {
    return this.getToken(Query.CLOSE_PAREN, 0);
  }
  constructor(ctx: ExprContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitParenQueryExpr) {
      return visitor.visitParenQueryExpr(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class QueryStatementContext extends ParserRuleContext {
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_queryStatement;
  }
  public copyFrom(ctx: QueryStatementContext): void {
    super.copyFrom(ctx);
  }
}
export class PrimaryExprPredicateContext extends QueryStatementContext {
  public predicate(): PredicateContext {
    return this.getRuleContext(0, PredicateContext);
  }
  constructor(ctx: QueryStatementContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitPrimaryExprPredicate) {
      return visitor.visitPrimaryExprPredicate(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}
export class PrimaryExprIsContext extends QueryStatementContext {
  public fieldIdentifier(): FieldIdentifierContext {
    return this.getRuleContext(0, FieldIdentifierContext);
  }
  public isOp(): IsOpContext {
    return this.getRuleContext(0, IsOpContext);
  }
  constructor(ctx: QueryStatementContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitPrimaryExprIs) {
      return visitor.visitPrimaryExprIs(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}
export class PrimaryExprCompareContext extends QueryStatementContext {
  public fieldIdentifier(): FieldIdentifierContext {
    return this.getRuleContext(0, FieldIdentifierContext);
  }
  public compOp(): CompOpContext {
    return this.getRuleContext(0, CompOpContext);
  }
  public value(): ValueContext {
    return this.getRuleContext(0, ValueContext);
  }
  constructor(ctx: QueryStatementContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitPrimaryExprCompare) {
      return visitor.visitPrimaryExprCompare(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class PredicateContext extends ParserRuleContext {
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_predicate;
  }
  public copyFrom(ctx: PredicateContext): void {
    super.copyFrom(ctx);
  }
}
export class PredicateExprLikeContext extends PredicateContext {
  public fieldIdentifier(): FieldIdentifierContext {
    return this.getRuleContext(0, FieldIdentifierContext);
  }
  public likeOp(): LikeOpContext {
    return this.getRuleContext(0, LikeOpContext);
  }
  public value(): ValueContext {
    return this.getRuleContext(0, ValueContext);
  }
  constructor(ctx: PredicateContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitPredicateExprLike) {
      return visitor.visitPredicateExprLike(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}
export class PredicateExprInContext extends PredicateContext {
  public fieldIdentifier(): FieldIdentifierContext {
    return this.getRuleContext(0, FieldIdentifierContext);
  }
  public inOp(): InOpContext {
    return this.getRuleContext(0, InOpContext);
  }
  public valueList(): ValueListContext {
    return this.getRuleContext(0, ValueListContext);
  }
  constructor(ctx: PredicateContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitPredicateExprIn) {
      return visitor.visitPredicateExprIn(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}
export class PredicateExprHasContext extends PredicateContext {
  public fieldIdentifier(): FieldIdentifierContext {
    return this.getRuleContext(0, FieldIdentifierContext);
  }
  public HAS_SYMBOL(): TerminalNode {
    return this.getToken(Query.HAS_SYMBOL, 0);
  }
  public valueList(): ValueListContext {
    return this.getRuleContext(0, ValueListContext);
  }
  constructor(ctx: PredicateContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitPredicateExprHas) {
      return visitor.visitPredicateExprHas(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}
export class PredicateExprEqArrayContext extends PredicateContext {
  public fieldIdentifier(): FieldIdentifierContext {
    return this.getRuleContext(0, FieldIdentifierContext);
  }
  public EQUAL_OPERATOR(): TerminalNode {
    return this.getToken(Query.EQUAL_OPERATOR, 0);
  }
  public valueList(): ValueListContext {
    return this.getRuleContext(0, ValueListContext);
  }
  constructor(ctx: PredicateContext) {
    super(ctx.parent, ctx.invokingState);
    this.copyFrom(ctx);
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitPredicateExprEqArray) {
      return visitor.visitPredicateExprEqArray(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class FieldIdentifierContext extends ParserRuleContext {
  public SIMPLE_IDENTIFIER(): TerminalNode {
    return this.getToken(Query.SIMPLE_IDENTIFIER, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_fieldIdentifier;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitFieldIdentifier) {
      return visitor.visitFieldIdentifier(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class CompOpContext extends ParserRuleContext {
  public EQUAL_OPERATOR(): TerminalNode | undefined {
    return this.tryGetToken(Query.EQUAL_OPERATOR, 0);
  }
  public NOT_EQUAL_OPERATOR(): TerminalNode | undefined {
    return this.tryGetToken(Query.NOT_EQUAL_OPERATOR, 0);
  }
  public NOT_EQUAL2_OPERATOR(): TerminalNode | undefined {
    return this.tryGetToken(Query.NOT_EQUAL2_OPERATOR, 0);
  }
  public GT_OPERATOR(): TerminalNode | undefined {
    return this.tryGetToken(Query.GT_OPERATOR, 0);
  }
  public GTE_OPERATOR(): TerminalNode | undefined {
    return this.tryGetToken(Query.GTE_OPERATOR, 0);
  }
  public LT_OPERATOR(): TerminalNode | undefined {
    return this.tryGetToken(Query.LT_OPERATOR, 0);
  }
  public LTE_OPERATOR(): TerminalNode | undefined {
    return this.tryGetToken(Query.LTE_OPERATOR, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_compOp;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitCompOp) {
      return visitor.visitCompOp(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class IsOpContext extends ParserRuleContext {
  public LS_NULL_SYMBOL(): TerminalNode | undefined {
    return this.tryGetToken(Query.LS_NULL_SYMBOL, 0);
  }
  public LS_NOT_NULL_SYMBOL(): TerminalNode | undefined {
    return this.tryGetToken(Query.LS_NOT_NULL_SYMBOL, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_isOp;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitIsOp) {
      return visitor.visitIsOp(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class LikeOpContext extends ParserRuleContext {
  public LIKE_SYMBOL(): TerminalNode | undefined {
    return this.tryGetToken(Query.LIKE_SYMBOL, 0);
  }
  public NOT_LIKE_SYMBOL(): TerminalNode | undefined {
    return this.tryGetToken(Query.NOT_LIKE_SYMBOL, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_likeOp;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitLikeOp) {
      return visitor.visitLikeOp(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class InOpContext extends ParserRuleContext {
  public IN_SYMBOL(): TerminalNode | undefined {
    return this.tryGetToken(Query.IN_SYMBOL, 0);
  }
  public NOT_IN_SYMBOL(): TerminalNode | undefined {
    return this.tryGetToken(Query.NOT_IN_SYMBOL, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_inOp;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitInOp) {
      return visitor.visitInOp(this);
    } else {
      return visitor.visitChildren(this);
    }
  }
}

export class ValueContext extends ParserRuleContext {
  public literal(): LiteralContext {
    return this.getRuleContext(0, LiteralContext);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_value;
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

export class ValueListContext extends ParserRuleContext {
  public OPEN_PAREN(): TerminalNode {
    return this.getToken(Query.OPEN_PAREN, 0);
  }
  public CLOSE_PAREN(): TerminalNode {
    return this.getToken(Query.CLOSE_PAREN, 0);
  }
  public literal(): LiteralContext[];
  public literal(i: number): LiteralContext;
  public literal(i?: number): LiteralContext | LiteralContext[] {
    if (i === undefined) {
      return this.getRuleContexts(LiteralContext);
    } else {
      return this.getRuleContext(i, LiteralContext);
    }
  }
  public COMMA(): TerminalNode[];
  public COMMA(i: number): TerminalNode;
  public COMMA(i?: number): TerminalNode | TerminalNode[] {
    if (i === undefined) {
      return this.getTokens(Query.COMMA);
    } else {
      return this.getToken(Query.COMMA, i);
    }
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_valueList;
  }
  // @Override
  public accept<Result>(visitor: QueryVisitor<Result>): Result {
    if (visitor.visitValueList) {
      return visitor.visitValueList(this);
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
    return Query.RULE_literal;
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
    return this.tryGetToken(Query.SINGLEQ_STRING_LITERAL, 0);
  }
  public DOUBLEQ_STRING_LITERAL(): TerminalNode | undefined {
    return this.tryGetToken(Query.DOUBLEQ_STRING_LITERAL, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_stringLiteral;
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
    return this.tryGetToken(Query.INTEGER_LITERAL, 0);
  }
  public NUMERIC_LITERAL(): TerminalNode | undefined {
    return this.tryGetToken(Query.NUMERIC_LITERAL, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_numberLiteral;
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
  public TRUE_SYMBOL(): TerminalNode | undefined {
    return this.tryGetToken(Query.TRUE_SYMBOL, 0);
  }
  public FALSE_SYMBOL(): TerminalNode | undefined {
    return this.tryGetToken(Query.FALSE_SYMBOL, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_booleanLiteral;
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
  public NULL_SYMBOL(): TerminalNode {
    return this.getToken(Query.NULL_SYMBOL, 0);
  }
  constructor(parent: ParserRuleContext | undefined, invokingState: number) {
    super(parent, invokingState);
  }
  // @Override
  public get ruleIndex(): number {
    return Query.RULE_nullLiteral;
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
