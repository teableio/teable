import { CharStreams, Token } from 'antlr4ts';
import type { ParseTree } from 'antlr4ts/tree/ParseTree';
import type { ExprContext } from './parser/Formula';
import { FormulaLexer } from './parser/FormulaLexer';

/** Version-one source admission ceiling; retained legacy expressions omit admission. */
export const defaultFormulaSourceBudgetLimits = Object.freeze({
  astDepth: 64,
  visitedNodes: 32768,
  referenceDepth: 64,
});

export type FormulaStructureCheck = (
  metric: 'astDepth' | 'visitedNodes',
  attempted: number
) => void;

const binaryPrecedence = (token: number): number => {
  switch (token) {
    case FormulaLexer.SLASH:
    case FormulaLexer.STAR:
    case FormulaLexer.PERCENT:
      return 9;
    case FormulaLexer.PLUS:
    case FormulaLexer.MINUS:
      return 8;
    case FormulaLexer.GT:
    case FormulaLexer.LT:
    case FormulaLexer.GTE:
    case FormulaLexer.LTE:
      return 7;
    case FormulaLexer.EQUAL:
    case FormulaLexer.BANG_EQUAL:
      return 6;
    case FormulaLexer.AMP_AMP:
      return 5;
    case FormulaLexer.PIPE_PIPE:
      return 4;
    case FormulaLexer.AMP:
      return 3;
    default:
      return -1;
  }
};

const isWhitespace = (token: number): boolean =>
  token === FormulaLexer.WHITESPACE ||
  token === FormulaLexer.BLOCK_COMMENT ||
  token === FormulaLexer.LINE_COMMENT;

type ExpressionFrame = {
  precedence: number;
  stage: 'prefix' | 'tail' | 'bracket' | 'function';
};

class FormulaStructureScanner {
  private readonly lexer: FormulaLexer;
  private readonly frames: ExpressionFrame[] = [];
  private token: number;
  private visitedNodes = 0;

  constructor(
    expression: string,
    private readonly check: FormulaStructureCheck
  ) {
    this.lexer = new FormulaLexer(CharStreams.fromString(expression));
    this.lexer.removeErrorListeners();
    this.token = this.lexer.nextToken().type;
  }

  scan(): void {
    this.enter(0);
    while (this.frames.length > 0 && this.token !== Token.EOF) {
      const frame = this.frames[this.frames.length - 1];
      switch (frame.stage) {
        case 'prefix':
          this.scanPrefix(frame);
          break;
        case 'bracket':
          if (this.token === FormulaLexer.CLOSE_PAREN) this.token = this.consume();
          frame.stage = 'tail';
          break;
        case 'function':
          this.scanFunction(frame);
          break;
        case 'tail':
          this.scanTail(frame);
          break;
      }
    }
    this.scanTrailingInput();
  }

  private consume(): number {
    this.check('visitedNodes', ++this.visitedNodes);
    return this.lexer.nextToken().type;
  }

  private enter(precedence: number): void {
    // Root, active expression rules and the next expression's terminal.
    this.check('astDepth', this.frames.length + 3);
    this.frames.push({ precedence, stage: 'prefix' });
  }

  private scanPrefix(frame: ExpressionFrame): void {
    frame.stage = 'tail';
    const token = this.token;
    if (isWhitespace(token) || token === FormulaLexer.MINUS) {
      this.token = this.consume();
      this.enter(isWhitespace(token) ? 13 : 10);
      return;
    }
    if (token === FormulaLexer.OPEN_PAREN) {
      frame.stage = 'bracket';
      this.token = this.consume();
      this.enter(0);
      return;
    }
    if (token === FormulaLexer.IDENTIFIER || token === FormulaLexer.IDENTIFIER_UNICODE) {
      this.scanCall(frame);
      return;
    }
    if (token === FormulaLexer.IDENTIFIER_VARIABLE) this.check('astDepth', this.frames.length + 3);
    this.token = this.consume();
  }

  private scanCall(frame: ExpressionFrame): void {
    // func_name -> identifier -> terminal adds two rule levels.
    this.check('astDepth', this.frames.length + 4);
    this.token = this.consume();
    if (this.token !== FormulaLexer.OPEN_PAREN) return;
    this.token = this.consume();
    if (this.token === FormulaLexer.CLOSE_PAREN) {
      this.token = this.consume();
    } else {
      frame.stage = 'function';
      this.enter(0);
    }
  }

  private scanFunction(frame: ExpressionFrame): void {
    if (this.token === FormulaLexer.COMMA) {
      this.token = this.consume();
      this.enter(0);
    } else {
      if (this.token === FormulaLexer.CLOSE_PAREN) this.token = this.consume();
      frame.stage = 'tail';
    }
  }

  private scanTail(frame: ExpressionFrame): void {
    if (isWhitespace(this.token) && frame.precedence <= 12) {
      this.token = this.consume();
      return;
    }
    const precedence = binaryPrecedence(this.token);
    if (precedence >= frame.precedence) {
      this.token = this.consume();
      this.enter(precedence + 1);
    } else {
      this.frames.pop();
    }
  }

  private scanTrailingInput(): void {
    // Parser recovery may consume malformed suffixes after a valid prefix.
    let depth = 1;
    while (this.token !== Token.EOF) {
      if (
        this.token === FormulaLexer.OPEN_PAREN ||
        this.token === FormulaLexer.MINUS ||
        isWhitespace(this.token)
      ) {
        this.check('astDepth', ++depth + 2);
      }
      this.token = this.consume();
    }
  }
}

/**
 * Checks recursive grammar entry depth before invoking the generated parser.
 * This is an iterative simulation of Formula.g4's precedence rules, not a
 * syntax validator. Invalid tokens remain the generated parser's responsibility.
 * Lexer tokens keep quoted strings, field names and comment contents opaque.
 * visitedNodes is a per-source token lower bound, not an additional AST charge.
 */
export function inspectFormulaStructure(expression: string, check: FormulaStructureCheck): void {
  new FormulaStructureScanner(expression, check).scan();
}

/** Checks every parse-tree node before a recursive visitor can run. */
export function inspectFormulaAst(tree: ExprContext, check: FormulaStructureCheck): void {
  const frames: { node: ParseTree; nextChild: number }[] = [];
  let visitedNodes = 0;
  const enter = (node: ParseTree): void => {
    check('visitedNodes', ++visitedNodes);
    check('astDepth', frames.length + 1);
    frames.push({ node, nextChild: 0 });
  };
  enter(tree);
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.nextChild === frame.node.childCount) {
      frames.pop();
    } else {
      enter(frame.node.getChild(frame.nextChild++));
    }
  }
}
