import {
  BinaryOpContext,
  BracketsContext,
  CharStreams,
  CommonTokenStream,
  defaultFormulaSourceBudgetLimits,
  extractFieldReferenceId,
  FieldReferenceCurlyContext,
  Formula,
  FormulaLexer,
  FunctionCallContext,
  inspectFormulaAst,
  inspectFormulaStructure,
  LeftWhitespaceOrCommentsContext,
  RightWhitespaceOrCommentsContext,
  UnaryOpContext,
} from '@teable/formula';
import type {
  ANTLRErrorListener,
  ATNSimulator,
  ExprContext,
  FormulaStructureCheck,
  RecognitionException,
  Recognizer,
  RootContext,
  Token,
} from '@teable/formula';

/**
 * Structural formula facts used by the schema-only complexity profile.
 *
 * The profile describes the formula source itself. It never evaluates the
 * expression, so values, row counts and SQL are intentionally absent.
 */
export type FormulaProfile = {
  readonly status: 'ok' | 'invalid' | 'truncated';
  /** Longest path through the semantic AST, counting only value/operator nodes. */
  readonly astDepth: number | null;
  /** Number of semantic AST nodes; grammar wrappers are not counted. */
  readonly astNodeCount: number | null;
  /** Number of nodes in the full ANTLR parse tree, including grammar wrappers. */
  readonly parseTreeNodeCount: number | null;
  /** Field-reference occurrences, including repeated references. */
  readonly referenceCount: number | null;
  /** Distinct referenced field ids. */
  readonly uniqueReferenceCount: number | null;
  /** Canonical function-name occurrence counts. */
  readonly functionCalls: Readonly<Record<string, number>>;
  /** Function-call occurrence counts grouped by family. */
  readonly functionCallsByCategory: Readonly<Record<string, number>>;
  /** True when the formula references no fields. Null when it cannot be determined. */
  readonly contextFree: boolean | null;
  /** True when the formula reads row/system identity or timestamps. */
  readonly recordContext: boolean;
  /** True when the formula depends on evaluation time. */
  readonly volatile: boolean;
  readonly warnings: ReadonlyArray<string>;
};

type FormulaFunctionCategory =
  | 'numeric'
  | 'text'
  | 'logical'
  | 'dateTime'
  | 'array'
  | 'system'
  | 'regexp'
  | 'unknown';

// Mirrors the canonical aliases in @teable/v2-core's formula catalog so this
// module depends only on the formula parser.
const FUNCTION_NAME_ALIASES: Readonly<Record<string, string>> = {
  ARRAYJOIN: 'ARRAY_JOIN',
  ARRAYUNIQUE: 'ARRAY_UNIQUE',
  ARRAYFLATTEN: 'ARRAY_FLATTEN',
  ARRAYCOMPACT: 'ARRAY_COMPACT',
};

// Mirrors the registered formula function families. Unknown names stay
// profiled but are grouped as `unknown` instead of being silently dropped.
const FUNCTION_CATEGORIES: Readonly<Record<string, FormulaFunctionCategory>> = {
  // Numeric
  SUM: 'numeric',
  AVERAGE: 'numeric',
  MAX: 'numeric',
  MIN: 'numeric',
  ROUND: 'numeric',
  ROUNDUP: 'numeric',
  ROUNDDOWN: 'numeric',
  CEILING: 'numeric',
  FLOOR: 'numeric',
  EVEN: 'numeric',
  ODD: 'numeric',
  INT: 'numeric',
  ABS: 'numeric',
  SQRT: 'numeric',
  POWER: 'numeric',
  EXP: 'numeric',
  LOG: 'numeric',
  MOD: 'numeric',
  VALUE: 'numeric',

  // Text
  CONCATENATE: 'text',
  FIND: 'text',
  SEARCH: 'text',
  MID: 'text',
  LEFT: 'text',
  RIGHT: 'text',
  REPLACE: 'text',
  SUBSTITUTE: 'text',
  TEXTBEFORE: 'text',
  TEXTSPLIT: 'text',
  LOWER: 'text',
  UPPER: 'text',
  REPT: 'text',
  TRIM: 'text',
  LEN: 'text',
  T: 'text',
  ENCODE_URL_COMPONENT: 'text',

  // Regexp
  REGEXP_REPLACE: 'regexp',

  // Logical
  IF: 'logical',
  SWITCH: 'logical',
  AND: 'logical',
  OR: 'logical',
  XOR: 'logical',
  NOT: 'logical',
  BLANK: 'logical',
  ERROR: 'logical',
  IS_ERROR: 'logical',

  // DateTime
  TODAY: 'dateTime',
  NOW: 'dateTime',
  YEAR: 'dateTime',
  MONTH: 'dateTime',
  WEEKNUM: 'dateTime',
  WEEKDAY: 'dateTime',
  DAY: 'dateTime',
  HOUR: 'dateTime',
  MINUTE: 'dateTime',
  SECOND: 'dateTime',
  FROMNOW: 'dateTime',
  TONOW: 'dateTime',
  DATETIME_DIFF: 'dateTime',
  WORKDAY: 'dateTime',
  WORKDAY_DIFF: 'dateTime',
  IS_SAME: 'dateTime',
  IS_AFTER: 'dateTime',
  IS_BEFORE: 'dateTime',
  DATE_ADD: 'dateTime',
  DATESTR: 'dateTime',
  TIMESTR: 'dateTime',
  DATETIME_FORMAT: 'dateTime',
  DATETIME_PARSE: 'dateTime',
  SET_LOCALE: 'dateTime',
  SET_TIMEZONE: 'dateTime',
  CREATED_TIME: 'dateTime',
  LAST_MODIFIED_TIME: 'dateTime',

  // Array
  COUNTALL: 'array',
  COUNTA: 'array',
  COUNT: 'array',
  ARRAY_JOIN: 'array',
  ARRAY_UNIQUE: 'array',
  ARRAY_FLATTEN: 'array',
  ARRAY_COMPACT: 'array',

  // System
  TEXT_ALL: 'system',
  RECORD_ID: 'system',
  AUTO_NUMBER: 'system',
};

const RECORD_CONTEXT_FUNCTIONS: Readonly<Record<string, true>> = {
  RECORD_ID: true,
  AUTO_NUMBER: true,
  CREATED_TIME: true,
  LAST_MODIFIED_TIME: true,
  TEXT_ALL: true,
};

const VOLATILE_FUNCTIONS: Readonly<Record<string, true>> = {
  NOW: true,
  TODAY: true,
  FROMNOW: true,
  TONOW: true,
};

class FormulaProfileLimitExceeded extends Error {
  constructor(
    readonly metric: 'astDepth' | 'visitedNodes',
    readonly attempted: number,
    readonly limit: number
  ) {
    super(metric);
  }
}

class FormulaProfileErrorCollector {
  private readonly messages: string[] = [];

  record(message: string): void {
    const normalized = message.split('expecting')[0].trim();
    if (normalized) this.messages.push(normalized);
  }

  firstError(): string | undefined {
    return this.messages[0];
  }
}

class FormulaProfileErrorListener<TSymbol> implements ANTLRErrorListener<TSymbol> {
  constructor(private readonly collector: FormulaProfileErrorCollector) {}

  syntaxError<T extends TSymbol>(
    _recognizer: Recognizer<T, ATNSimulator>,
    _offendingSymbol: T | undefined,
    _line: number,
    _charPositionInLine: number,
    msg: string,
    _e: RecognitionException | undefined
  ): void {
    this.collector.record(msg);
  }
}

type TraversableParseTree = {
  readonly childCount: number;
  getChild(index: number): TraversableParseTree;
};

type SemanticFrame = {
  readonly context: ExprContext;
  readonly depth: number;
};

const incompleteProfile = (status: 'invalid' | 'truncated', warning: string): FormulaProfile => ({
  status,
  astDepth: null,
  astNodeCount: null,
  parseTreeNodeCount: null,
  referenceCount: null,
  uniqueReferenceCount: null,
  functionCalls: {},
  functionCallsByCategory: {},
  contextFree: null,
  recordContext: false,
  volatile: false,
  warnings: [warning],
});

const failureProfile = (error: unknown): FormulaProfile => {
  if (error instanceof FormulaProfileLimitExceeded) {
    const metric = error.metric === 'astDepth' ? 'AST depth' : 'node count';
    return incompleteProfile(
      'truncated',
      `Formula source exceeds ${metric} limit ${error.limit} (attempted ${error.attempted})`
    );
  }

  const message =
    error instanceof Error && error.message
      ? error.message
      : String(error) || 'Unknown formula analysis error';
  if (error instanceof RangeError || /stack|recursion|depth/i.test(message)) {
    return incompleteProfile(
      'truncated',
      `Formula source exceeds parser recursion limit: ${message}`
    );
  }
  return incompleteProfile('invalid', `Formula analysis failed: ${message}`);
};

const countParseTreeNodes = (tree: RootContext): number => {
  let count = 0;
  const stack: TraversableParseTree[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop() as TraversableParseTree;
    count += 1;
    for (let index = 0; index < node.childCount; index += 1) {
      stack.push(node.getChild(index));
    }
  }
  return count;
};

type SemanticFacts = {
  readonly astDepth: number;
  readonly astNodeCount: number;
  readonly referenceCount: number;
  readonly uniqueReferenceCount: number;
  readonly functionCalls: Readonly<Record<string, number>>;
  readonly functionCallsByCategory: Readonly<Record<string, number>>;
  readonly recordContext: boolean;
  readonly volatile: boolean;
};

// The walk must dispatch every semantic grammar node in one bounded loop;
// extracting each arm would obscure the iterative depth/reference invariants.
// eslint-disable-next-line sonarjs/cognitive-complexity
const inspectSemanticTree = (tree: RootContext): SemanticFacts => {
  const stack: SemanticFrame[] = [{ context: tree.expr(), depth: 1 }];
  const references = new Set<string>();
  const functionCalls: Record<string, number> = {};
  const functionCallsByCategory: Record<string, number> = {};
  let astDepth = 0;
  let astNodeCount = 0;
  let referenceCount = 0;
  let recordContext = false;
  let volatile = false;

  while (stack.length > 0) {
    const { context, depth } = stack.pop() as SemanticFrame;

    // Grammar-only wrappers keep the surrounding semantic depth.
    if (context instanceof LeftWhitespaceOrCommentsContext) {
      stack.push({ context: context.expr(), depth });
      continue;
    }
    if (context instanceof RightWhitespaceOrCommentsContext) {
      stack.push({ context: context.expr(), depth });
      continue;
    }
    if (context instanceof BracketsContext) {
      stack.push({ context: context.expr(), depth });
      continue;
    }

    astNodeCount += 1;
    if (depth > astDepth) astDepth = depth;

    if (context instanceof FunctionCallContext) {
      const token = context.func_name().text.toUpperCase();
      const name = FUNCTION_NAME_ALIASES[token] ?? token;
      functionCalls[name] = (functionCalls[name] ?? 0) + 1;
      const category = FUNCTION_CATEGORIES[name] ?? 'unknown';
      functionCallsByCategory[category] = (functionCallsByCategory[category] ?? 0) + 1;
      if (RECORD_CONTEXT_FUNCTIONS[name] === true) recordContext = true;
      if (VOLATILE_FUNCTIONS[name] === true) volatile = true;

      for (const argument of context.expr()) {
        stack.push({ context: argument, depth: depth + 1 });
      }
      continue;
    }

    if (context instanceof UnaryOpContext) {
      stack.push({ context: context.expr(), depth: depth + 1 });
      continue;
    }

    if (context instanceof BinaryOpContext) {
      stack.push({ context: context.expr(0), depth: depth + 1 });
      stack.push({ context: context.expr(1), depth: depth + 1 });
      continue;
    }

    if (context instanceof FieldReferenceCurlyContext) {
      const fieldId = extractFieldReferenceId(context);
      if (fieldId) {
        referenceCount += 1;
        references.add(fieldId);
      }
    }
  }

  return {
    astDepth,
    astNodeCount,
    referenceCount,
    uniqueReferenceCount: references.size,
    functionCalls,
    functionCallsByCategory,
    recordContext,
    volatile,
  };
};

/**
 * Inspect one formula source without evaluating it or touching a database.
 *
 * Parsing is guarded by the same structure limits used for formula admission.
 * An input that cannot be parsed or exceeds those limits returns a profile with
 * null metrics instead of throwing or reporting invented zeros.
 */
export function inspectFormulaProfile(expression: string): FormulaProfile {
  if (expression.trim().length === 0) {
    return incompleteProfile('invalid', 'Formula source is empty');
  }

  const limits = defaultFormulaSourceBudgetLimits;
  const check: FormulaStructureCheck = (metric, attempted) => {
    const limit = limits[metric];
    if (attempted > limit) {
      throw new FormulaProfileLimitExceeded(metric, attempted, limit);
    }
  };

  try {
    inspectFormulaStructure(expression, check);
  } catch (error) {
    return failureProfile(error);
  }

  const lexer = new FormulaLexer(CharStreams.fromString(expression));
  const errorCollector = new FormulaProfileErrorCollector();
  lexer.removeErrorListeners();
  lexer.addErrorListener(new FormulaProfileErrorListener<number>(errorCollector));

  const parser = new Formula(new CommonTokenStream(lexer));
  parser.removeErrorListeners();
  parser.addErrorListener(new FormulaProfileErrorListener<Token>(errorCollector));

  let tree: RootContext;
  try {
    tree = parser.root();
  } catch (error) {
    return failureProfile(error);
  }

  const syntaxError = errorCollector.firstError();
  if (syntaxError) {
    return incompleteProfile('invalid', syntaxError);
  }

  try {
    inspectFormulaAst(tree, check);
  } catch (error) {
    return failureProfile(error);
  }

  try {
    const facts = inspectSemanticTree(tree);
    return {
      status: 'ok',
      astDepth: facts.astDepth,
      astNodeCount: facts.astNodeCount,
      parseTreeNodeCount: countParseTreeNodes(tree),
      referenceCount: facts.referenceCount,
      uniqueReferenceCount: facts.uniqueReferenceCount,
      functionCalls: facts.functionCalls,
      functionCallsByCategory: facts.functionCallsByCategory,
      contextFree: facts.referenceCount === 0,
      recordContext: facts.recordContext,
      volatile: facts.volatile,
      warnings: [],
    };
  } catch (error) {
    return failureProfile(error);
  }
}
