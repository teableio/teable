import {
  ExprContext,
  BracketsContext,
  BinaryOpContext,
  FieldReferenceCurlyContext,
  LeftWhitespaceOrCommentsContext,
  RightWhitespaceOrCommentsContext,
  StringLiteralContext,
  extractFieldReferenceId,
  FieldReferenceVisitor,
  FunctionCallCollectorVisitor,
  FunctionCallContext,
} from '@teable/formula';
import { FunctionName, normalizeFunctionNameAlias, type DomainError } from '@teable/v2-core';
import { ok, type Result } from 'neverthrow';

import { formulaParseCache } from './FormulaParseCache';

// A deliberately closed set. Adding a compiler function does not implicitly make
// it safe for cross-statement fusion: clocks, record metadata, array/JSON work,
// regular expressions and unbounded text expansion retain their statement boundary.
const scalarFunctions = new Set<string>([
  FunctionName.Abs,
  FunctionName.Round,
  FunctionName.RoundUp,
  FunctionName.RoundDown,
  FunctionName.Ceiling,
  FunctionName.Floor,
  FunctionName.Int,
  FunctionName.Mod,
  FunctionName.Value,
  FunctionName.Concatenate,
  FunctionName.Mid,
  FunctionName.Left,
  FunctionName.Right,
  FunctionName.Lower,
  FunctionName.Upper,
  FunctionName.Trim,
  FunctionName.Len,
  FunctionName.T,
  FunctionName.If,
  FunctionName.Switch,
  FunctionName.And,
  FunctionName.Or,
  FunctionName.Not,
  FunctionName.Xor,
  FunctionName.Blank,
  FunctionName.Error,
  FunctionName.IsError,
  FunctionName.Year,
  FunctionName.Month,
  FunctionName.Day,
  FunctionName.Hour,
  FunctionName.Minute,
  FunctionName.Second,
  FunctionName.Weekday,
  FunctionName.WeekNum,
  FunctionName.DatetimeDiff,
  FunctionName.DateAdd,
  FunctionName.IsSame,
  FunctionName.IsBefore,
  FunctionName.IsAfter,
  FunctionName.Datestr,
  FunctionName.Timestr,
]);

const dateArguments = new Map<string, ReadonlyArray<number>>([
  ...[
    FunctionName.Year,
    FunctionName.Month,
    FunctionName.Day,
    FunctionName.Hour,
    FunctionName.Minute,
    FunctionName.Second,
    FunctionName.Weekday,
    FunctionName.WeekNum,
    FunctionName.DateAdd,
    FunctionName.Datestr,
    FunctionName.Timestr,
  ].map((name): [string, ReadonlyArray<number>] => [name, [0]]),
  ...[
    FunctionName.DatetimeDiff,
    FunctionName.IsSame,
    FunctionName.IsBefore,
    FunctionName.IsAfter,
  ].map((name): [string, ReadonlyArray<number>] => [name, [0, 1]]),
]);

export type DeterministicScalarFormula = {
  /** Syntax references only; callers must verify stored scalar field types. */
  fieldReferences: ReadonlyArray<string>;
  /** A conservative syntax budget, not an estimate of PG runtime cost. */
  cost: number;
};

type SyntaxNode = { childCount: number; getChild(index: number): SyntaxNode };

/**
 * Recognize a bounded, allowlisted scalar expression without resolving schema.
 * This alone does not prove scalar/deterministic execution: callers must exclude
 * computed/array inputs and verify scalar result metadata. The callback must
 * identify every date input; without it, references are conservatively unknown
 * in implicit date-coercion positions. No SQL is generated.
 */
export const analyzeDeterministicScalarFormula = (
  expression: string,
  options: {
    isStoredDateField?: (id: string) => boolean;
    /** The destination casts to datetime, including possibly stale field metadata. */
    requireDateResult?: boolean;
  } = {}
): Result<DeterministicScalarFormula | undefined, DomainError> => {
  if (expression.length > 256) return ok(undefined);
  return formulaParseCache.parse(expression).map((tree) => {
    const calls = tree.accept(new FunctionCallCollectorVisitor());
    if (
      calls.length > 8 ||
      calls.some((call) => !scalarFunctions.has(normalizeFunctionNameAlias(call.name)))
    ) {
      return undefined;
    }
    // PostgreSQL accepts relative timestamp text such as "now" and "today".
    // Date functions are deterministic only when date arguments are already typed
    // dates (or fixed ISO literals); scalar text inputs alone do not prove that.
    const isFixedDate = (node: ExprContext | undefined): boolean => {
      if (!node) return false;
      if (node instanceof FieldReferenceCurlyContext) {
        const fieldId = extractFieldReferenceId(node);
        return fieldId !== undefined && options.isStoredDateField?.(fieldId) === true;
      }
      if (node instanceof StringLiteralContext) {
        return /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(
          node.text.slice(1, -1)
        );
      }
      if (
        node instanceof BracketsContext ||
        node instanceof LeftWhitespaceOrCommentsContext ||
        node instanceof RightWhitespaceOrCommentsContext
      ) {
        return isFixedDate(node.expr());
      }
      if (node instanceof FunctionCallContext) {
        const name = normalizeFunctionNameAlias(node.func_name().text.toUpperCase());
        if (name === FunctionName.Blank) return true;
        if (name === FunctionName.DateAdd) return isFixedDate(node.expr()[0]);
        if (name === FunctionName.If)
          return isFixedDate(node.expr()[1]) && isFixedDate(node.expr()[2]);
      }
      return false;
    };
    const switchResults = (node: FunctionCallContext): ExprContext[] => {
      const args = node.expr();
      const results = args.filter((_, index) => index >= 2 && index % 2 === 0);
      if (args.length >= 2 && args.length % 2 === 0) results.push(args[args.length - 1]);
      return results;
    };
    // Over-approximate date-valued flow. In particular IF can silently coerce a
    // text branch to timestamptz, and comparisons do loose datetime casts. A date
    // hidden behind either construct must not turn relative text into a clock.
    const mayReturnDate = (node: ExprContext | undefined): boolean => {
      if (!node) return false;
      if (node instanceof FieldReferenceCurlyContext) {
        const fieldId = extractFieldReferenceId(node);
        // With no schema callback, a reference is unknown rather than non-date.
        return fieldId === undefined || options.isStoredDateField?.(fieldId) !== false;
      }
      if (
        node instanceof BracketsContext ||
        node instanceof LeftWhitespaceOrCommentsContext ||
        node instanceof RightWhitespaceOrCommentsContext
      ) {
        return mayReturnDate(node.expr());
      }
      if (node instanceof BinaryOpContext) {
        return (
          (node.PLUS() !== undefined || node.MINUS() !== undefined) &&
          node.expr().some(mayReturnDate)
        );
      }
      if (node instanceof FunctionCallContext) {
        const name = normalizeFunctionNameAlias(node.func_name().text.toUpperCase());
        if (name === FunctionName.DateAdd) return true;
        if (name === FunctionName.If) return node.expr().slice(1, 3).some(mayReturnDate);
        if (name === FunctionName.Switch) return switchResults(node).some(mayReturnDate);
      }
      return false;
    };
    const hasFixedDateArguments = (node: SyntaxNode): boolean => {
      if (node instanceof FunctionCallContext) {
        const name = normalizeFunctionNameAlias(node.func_name().text.toUpperCase());
        if (dateArguments.get(name)?.some((index) => !isFixedDate(node.expr()[index])))
          return false;
        if (name === FunctionName.If) {
          const branches = node.expr().slice(1, 3);
          return !branches.some(mayReturnDate) || branches.every(isFixedDate);
        }
        // SWITCH mixes result types differently from IF and can stringify dates
        // using field formatting. Keep date-valued SWITCH outside this proof.
        if (name === FunctionName.Switch && switchResults(node).some(mayReturnDate)) return false;
      }
      if (
        node instanceof BinaryOpContext &&
        (node.EQUAL() || node.BANG_EQUAL() || node.LT() || node.LTE() || node.GT() || node.GTE())
      ) {
        const operands = node.expr();
        return !operands.some(mayReturnDate) || operands.every(isFixedDate);
      }
      return true;
    };
    let fixedDateArguments = !options.requireDateResult || isFixedDate(tree.expr());
    let nodes = 0;
    let maxFunctionDepth = 0;
    const visit = (node: SyntaxNode, functionDepth: number) => {
      if (node instanceof ExprContext) nodes += 1;
      if (!hasFixedDateArguments(node)) fixedDateArguments = false;
      const depth = functionDepth + (node instanceof FunctionCallContext ? 1 : 0);
      maxFunctionDepth = Math.max(maxFunctionDepth, depth);
      for (let index = 0; index < node.childCount; index++) visit(node.getChild(index), depth);
    };
    visit(tree, 0);
    const cost = nodes + calls.length * 8;
    if (!fixedDateArguments || cost > 256 || maxFunctionDepth > 4) return undefined;
    return {
      fieldReferences: [...new Set(tree.accept(new FieldReferenceVisitor()).map(String))],
      cost,
    };
  });
};
