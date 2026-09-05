import type {
  ANTLRErrorListener,
  ATNSimulator,
  Recognizer,
  RootContext,
  Token,
} from '@teable/formula';
import { CharStreams, CommonTokenStream, Formula, FormulaLexer } from '@teable/formula';
import { domainError, type DomainError } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

class FormulaParseErrorCollector implements ANTLRErrorListener<Token> {
  private error: string | undefined;

  syntaxError<T extends Token>(
    _recognizer: Recognizer<T, ATNSimulator>,
    _offendingSymbol: T | undefined,
    _line: number,
    _charPositionInLine: number,
    msg: string
  ): void {
    this.error ??= msg.split('expecting')[0].trim();
  }

  firstError(): string | undefined {
    return this.error;
  }
}

export const parseFormulaExpression = (expression: string): Result<RootContext, DomainError> => {
  const lexer = new FormulaLexer(CharStreams.fromString(expression));
  const parser = new Formula(new CommonTokenStream(lexer));
  parser.removeErrorListeners();
  const collector = new FormulaParseErrorCollector();
  parser.addErrorListener(collector);
  const tree = parser.root();
  const error = collector.firstError();
  return error ? err(domainError.validation({ message: error })) : ok(tree);
};

/**
 * Process-local LRU of syntax only. Visitors must treat shared trees as read-only.
 * Field resolution, types, timezone, SQL aliases and validation strategies are
 * deliberately rebuilt in each translator, so schema changes need no invalidation.
 * Both entry count and retained source length are bounded; source length is a
 * proxy for tree/token size, not a claim about exact heap usage. Oversized inputs
 * remain supported but bypass retention. Errors are not retained.
 */
export class FormulaParseCache {
  private readonly entries = new Map<string, RootContext>();
  private retainedSourceLength = 0;

  constructor(
    private readonly maxEntries = 256,
    private readonly maxSourceLength = 256 * 1024,
    private readonly maxExpressionLength = 16 * 1024
  ) {}

  parse(expression: string): Result<RootContext, DomainError> {
    const cached = this.entries.get(expression);
    if (cached) {
      this.entries.delete(expression);
      this.entries.set(expression, cached);
      return ok(cached);
    }
    const parsed = parseFormulaExpression(expression);
    if (
      parsed.isErr() ||
      this.maxEntries <= 0 ||
      expression.length > this.maxExpressionLength ||
      expression.length > this.maxSourceLength
    ) {
      return parsed;
    }
    while (
      this.entries.size >= this.maxEntries ||
      this.retainedSourceLength + expression.length > this.maxSourceLength
    ) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
      this.retainedSourceLength -= oldest.value.length;
    }
    this.entries.set(expression, parsed.value);
    this.retainedSourceLength += expression.length;
    return parsed;
  }
}

export const formulaParseCache = new FormulaParseCache();
