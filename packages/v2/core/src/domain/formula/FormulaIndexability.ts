import {
  AbstractParseTreeVisitor,
  type BinaryOpContext,
  type BracketsContext,
  FunctionCallCollectorVisitor,
  type FunctionCallContext,
  type FormulaVisitor,
  type LeftWhitespaceOrCommentsContext,
  parseFormula,
  type RightWhitespaceOrCommentsContext,
  type RootContext,
  type UnaryOpContext,
} from '@teable/formula';
import { err, ok, type Result } from 'neverthrow';

import { domainError, type DomainError } from '../shared/DomainError';
import { FormulaExpression } from '../table/fields/types/FormulaExpression';
import { normalizeFunctionNameAlias } from './function-aliases';
import { FunctionName } from './functions/common';

export const formulaIndexabilityKindValues = [
  'none',
  'source_field',
  'formula_result',
  'expression',
] as const;
export type FormulaIndexabilityKind = (typeof formulaIndexabilityKindValues)[number];

export const formulaIndexCandidateKindValues = ['btree', 'gin_trgm', 'btree_text_pattern'] as const;
export type FormulaIndexCandidateKind = (typeof formulaIndexCandidateKindValues)[number];

export const formulaIndexOperatorFamilyValues = [
  'text_contains',
  'text_prefix',
  'equality',
  'range',
  'formula_result',
] as const;
export type FormulaIndexOperatorFamily = (typeof formulaIndexOperatorFamilyValues)[number];

export type FormulaIndexabilityDescriptor = {
  readonly functionName: FunctionName;
  readonly kind: FormulaIndexabilityKind;
  readonly stable: boolean;
  readonly expressionIndexability: FormulaExpressionIndexability;
  readonly argumentRoles: ReadonlyArray<'source_field' | 'literal' | 'expression' | 'unknown'>;
  readonly operatorFamilies: ReadonlyArray<FormulaIndexOperatorFamily>;
  readonly candidateIndexes: ReadonlyArray<FormulaIndexCandidateKind>;
  readonly reason?: string;
};

export type FormulaExpressionIndexability = {
  readonly supported: boolean;
  readonly reason: string;
};

export type FormulaAccessPathAnalysis = {
  readonly referencedFieldIds: readonly string[];
  readonly functions: ReadonlyArray<{
    readonly name: FunctionName;
    readonly paramCount: number;
    readonly descriptor: FormulaIndexabilityDescriptor;
  }>;
  readonly stable: boolean;
  readonly sourceKind: 'formula_result' | 'formula_source' | 'formula_expression';
  readonly operatorFamilies: ReadonlyArray<FormulaIndexOperatorFamily>;
  readonly candidateIndexes: ReadonlyArray<FormulaIndexCandidateKind>;
  readonly skippedReasons: readonly string[];
  readonly expressionIndexable: boolean;
  readonly expressionIndexSkippedReasons: readonly string[];
  readonly predicatePushdown?: FormulaPredicatePushdownAnalysis;
};

export type FormulaPredicatePushdownAnalysis = {
  readonly supported: boolean;
  readonly operatorFamilies: ReadonlyArray<FormulaIndexOperatorFamily>;
  readonly sourceFunctionNames: ReadonlyArray<FunctionName>;
  readonly skippedReasons: readonly string[];
};

const descriptor = (
  functionName: FunctionName,
  input: Omit<FormulaIndexabilityDescriptor, 'functionName'>
): FormulaIndexabilityDescriptor => ({ functionName, ...input });

const defaultDescriptor = (functionName: FunctionName): FormulaIndexabilityDescriptor =>
  descriptor(functionName, {
    kind: 'formula_result',
    stable: true,
    expressionIndexability: {
      supported: false,
      reason: 'formula_result_index_only',
    },
    argumentRoles: ['expression'],
    operatorFamilies: ['formula_result'],
    candidateIndexes: ['btree'],
    reason: 'formula_result_index_only',
  });

const nonStableDescriptor = (
  functionName: FunctionName,
  reason = 'non_stable_formula'
): FormulaIndexabilityDescriptor =>
  descriptor(functionName, {
    kind: 'none',
    stable: false,
    expressionIndexability: {
      supported: false,
      reason,
    },
    argumentRoles: ['unknown'],
    operatorFamilies: [],
    candidateIndexes: [],
    reason,
  });

const formulaIndexabilityDescriptors: Record<FunctionName, FormulaIndexabilityDescriptor> = {
  [FunctionName.Sum]: defaultDescriptor(FunctionName.Sum),
  [FunctionName.Average]: defaultDescriptor(FunctionName.Average),
  [FunctionName.Max]: defaultDescriptor(FunctionName.Max),
  [FunctionName.Min]: defaultDescriptor(FunctionName.Min),
  [FunctionName.Round]: defaultDescriptor(FunctionName.Round),
  [FunctionName.RoundUp]: defaultDescriptor(FunctionName.RoundUp),
  [FunctionName.RoundDown]: defaultDescriptor(FunctionName.RoundDown),
  [FunctionName.Ceiling]: defaultDescriptor(FunctionName.Ceiling),
  [FunctionName.Floor]: defaultDescriptor(FunctionName.Floor),
  [FunctionName.Even]: defaultDescriptor(FunctionName.Even),
  [FunctionName.Odd]: defaultDescriptor(FunctionName.Odd),
  [FunctionName.Int]: defaultDescriptor(FunctionName.Int),
  [FunctionName.Abs]: defaultDescriptor(FunctionName.Abs),
  [FunctionName.Sqrt]: defaultDescriptor(FunctionName.Sqrt),
  [FunctionName.Power]: defaultDescriptor(FunctionName.Power),
  [FunctionName.Exp]: defaultDescriptor(FunctionName.Exp),
  [FunctionName.Log]: defaultDescriptor(FunctionName.Log),
  [FunctionName.Mod]: defaultDescriptor(FunctionName.Mod),
  [FunctionName.Value]: defaultDescriptor(FunctionName.Value),

  [FunctionName.Concatenate]: defaultDescriptor(FunctionName.Concatenate),
  [FunctionName.Find]: descriptor(FunctionName.Find, {
    kind: 'source_field',
    stable: true,
    expressionIndexability: {
      supported: true,
      reason: 'text_position_expression_index_candidate',
    },
    argumentRoles: ['literal', 'source_field', 'unknown'],
    operatorFamilies: ['text_contains'],
    candidateIndexes: ['gin_trgm'],
    reason: 'text_position_lookup_can_use_source_trigram',
  }),
  [FunctionName.Search]: descriptor(FunctionName.Search, {
    kind: 'source_field',
    stable: true,
    expressionIndexability: {
      supported: true,
      reason: 'text_position_expression_index_candidate',
    },
    argumentRoles: ['literal', 'source_field', 'unknown'],
    operatorFamilies: ['text_contains'],
    candidateIndexes: ['gin_trgm'],
    reason: 'text_position_lookup_can_use_source_trigram',
  }),
  [FunctionName.Mid]: descriptor(FunctionName.Mid, {
    kind: 'expression',
    stable: true,
    expressionIndexability: {
      supported: true,
      reason: 'text_slice_expression_index_candidate',
    },
    argumentRoles: ['source_field', 'literal', 'literal'],
    operatorFamilies: ['formula_result'],
    candidateIndexes: ['btree'],
    reason: 'expression_index_candidate_only',
  }),
  [FunctionName.Left]: descriptor(FunctionName.Left, {
    kind: 'source_field',
    stable: true,
    expressionIndexability: {
      supported: true,
      reason: 'left_expression_index_candidate',
    },
    argumentRoles: ['source_field', 'literal'],
    operatorFamilies: ['text_prefix'],
    candidateIndexes: ['btree', 'btree_text_pattern'],
    reason: 'left_prefix_can_use_source_prefix_or_expression_index',
  }),
  [FunctionName.Right]: descriptor(FunctionName.Right, {
    kind: 'expression',
    stable: true,
    expressionIndexability: {
      supported: true,
      reason: 'right_expression_index_candidate',
    },
    argumentRoles: ['source_field', 'literal'],
    operatorFamilies: ['formula_result'],
    candidateIndexes: ['btree'],
    reason: 'expression_index_candidate_only',
  }),
  [FunctionName.Replace]: defaultDescriptor(FunctionName.Replace),
  [FunctionName.RegExpReplace]: descriptor(FunctionName.RegExpReplace, {
    kind: 'expression',
    stable: true,
    expressionIndexability: {
      supported: true,
      reason: 'regexp_replace_expression_index_candidate',
    },
    argumentRoles: ['source_field', 'literal', 'literal'],
    operatorFamilies: ['formula_result'],
    candidateIndexes: ['btree'],
    reason: 'expression_index_candidate_only',
  }),
  [FunctionName.Substitute]: defaultDescriptor(FunctionName.Substitute),
  [FunctionName.TextBefore]: descriptor(FunctionName.TextBefore, {
    kind: 'source_field',
    stable: true,
    expressionIndexability: {
      supported: true,
      reason: 'text_before_expression_index_candidate',
    },
    argumentRoles: ['source_field', 'literal'],
    operatorFamilies: ['text_prefix'],
    candidateIndexes: ['btree', 'btree_text_pattern'],
    reason: 'text_before_can_use_source_prefix_or_expression_index',
  }),
  [FunctionName.TextSplit]: defaultDescriptor(FunctionName.TextSplit),
  [FunctionName.Lower]: descriptor(FunctionName.Lower, {
    kind: 'expression',
    stable: true,
    expressionIndexability: {
      supported: true,
      reason: 'case_normalized_expression_index_candidate',
    },
    argumentRoles: ['source_field'],
    operatorFamilies: ['equality', 'text_prefix'],
    candidateIndexes: ['btree', 'btree_text_pattern'],
    reason: 'case_normalized_expression_index_candidate',
  }),
  [FunctionName.Upper]: descriptor(FunctionName.Upper, {
    kind: 'expression',
    stable: true,
    expressionIndexability: {
      supported: true,
      reason: 'case_normalized_expression_index_candidate',
    },
    argumentRoles: ['source_field'],
    operatorFamilies: ['equality', 'text_prefix'],
    candidateIndexes: ['btree', 'btree_text_pattern'],
    reason: 'case_normalized_expression_index_candidate',
  }),
  [FunctionName.Rept]: defaultDescriptor(FunctionName.Rept),
  [FunctionName.Trim]: descriptor(FunctionName.Trim, {
    kind: 'expression',
    stable: true,
    expressionIndexability: {
      supported: true,
      reason: 'trim_expression_index_candidate',
    },
    argumentRoles: ['source_field'],
    operatorFamilies: ['equality'],
    candidateIndexes: ['btree'],
    reason: 'trim_expression_index_candidate',
  }),
  [FunctionName.Len]: descriptor(FunctionName.Len, {
    kind: 'expression',
    stable: true,
    expressionIndexability: {
      supported: true,
      reason: 'length_expression_index_candidate',
    },
    argumentRoles: ['source_field'],
    operatorFamilies: ['equality', 'range'],
    candidateIndexes: ['btree'],
    reason: 'length_expression_index_candidate',
  }),
  [FunctionName.T]: defaultDescriptor(FunctionName.T),
  [FunctionName.EncodeUrlComponent]: defaultDescriptor(FunctionName.EncodeUrlComponent),

  [FunctionName.If]: descriptor(FunctionName.If, {
    kind: 'formula_result',
    stable: true,
    expressionIndexability: {
      supported: true,
      reason: 'conditional_expression_index_candidate_when_children_supported',
    },
    argumentRoles: ['expression', 'literal', 'literal'],
    operatorFamilies: ['formula_result'],
    candidateIndexes: ['btree'],
    reason: 'conditional_formula_result_index_or_predicate_pushdown',
  }),
  [FunctionName.Switch]: defaultDescriptor(FunctionName.Switch),
  [FunctionName.And]: defaultDescriptor(FunctionName.And),
  [FunctionName.Or]: defaultDescriptor(FunctionName.Or),
  [FunctionName.Xor]: defaultDescriptor(FunctionName.Xor),
  [FunctionName.Not]: defaultDescriptor(FunctionName.Not),
  [FunctionName.Blank]: defaultDescriptor(FunctionName.Blank),
  [FunctionName.Error]: descriptor(FunctionName.Error, {
    kind: 'none',
    stable: true,
    expressionIndexability: {
      supported: false,
      reason: 'formula_error_not_indexable',
    },
    argumentRoles: ['unknown'],
    operatorFamilies: [],
    candidateIndexes: [],
    reason: 'formula_error_not_indexable',
  }),
  [FunctionName.IsError]: defaultDescriptor(FunctionName.IsError),

  [FunctionName.Today]: nonStableDescriptor(FunctionName.Today),
  [FunctionName.Now]: nonStableDescriptor(FunctionName.Now),
  [FunctionName.Year]: defaultDescriptor(FunctionName.Year),
  [FunctionName.Month]: defaultDescriptor(FunctionName.Month),
  [FunctionName.WeekNum]: defaultDescriptor(FunctionName.WeekNum),
  [FunctionName.Weekday]: defaultDescriptor(FunctionName.Weekday),
  [FunctionName.Day]: defaultDescriptor(FunctionName.Day),
  [FunctionName.Hour]: defaultDescriptor(FunctionName.Hour),
  [FunctionName.Minute]: defaultDescriptor(FunctionName.Minute),
  [FunctionName.Second]: defaultDescriptor(FunctionName.Second),
  [FunctionName.FromNow]: nonStableDescriptor(FunctionName.FromNow),
  [FunctionName.ToNow]: nonStableDescriptor(FunctionName.ToNow),
  [FunctionName.DatetimeDiff]: defaultDescriptor(FunctionName.DatetimeDiff),
  [FunctionName.Workday]: defaultDescriptor(FunctionName.Workday),
  [FunctionName.WorkdayDiff]: defaultDescriptor(FunctionName.WorkdayDiff),
  [FunctionName.IsSame]: defaultDescriptor(FunctionName.IsSame),
  [FunctionName.IsAfter]: defaultDescriptor(FunctionName.IsAfter),
  [FunctionName.IsBefore]: defaultDescriptor(FunctionName.IsBefore),
  [FunctionName.DateAdd]: defaultDescriptor(FunctionName.DateAdd),
  [FunctionName.Datestr]: defaultDescriptor(FunctionName.Datestr),
  [FunctionName.Timestr]: defaultDescriptor(FunctionName.Timestr),
  [FunctionName.DatetimeFormat]: defaultDescriptor(FunctionName.DatetimeFormat),
  [FunctionName.DatetimeParse]: defaultDescriptor(FunctionName.DatetimeParse),
  [FunctionName.SetLocale]: defaultDescriptor(FunctionName.SetLocale),
  [FunctionName.SetTimezone]: defaultDescriptor(FunctionName.SetTimezone),
  [FunctionName.CreatedTime]: defaultDescriptor(FunctionName.CreatedTime),
  [FunctionName.LastModifiedTime]: nonStableDescriptor(
    FunctionName.LastModifiedTime,
    'last_modified_time_formula_uses_stored_result'
  ),

  [FunctionName.CountAll]: defaultDescriptor(FunctionName.CountAll),
  [FunctionName.CountA]: defaultDescriptor(FunctionName.CountA),
  [FunctionName.Count]: defaultDescriptor(FunctionName.Count),
  [FunctionName.ArrayJoin]: defaultDescriptor(FunctionName.ArrayJoin),
  [FunctionName.ArrayUnique]: defaultDescriptor(FunctionName.ArrayUnique),
  [FunctionName.ArrayFlatten]: defaultDescriptor(FunctionName.ArrayFlatten),
  [FunctionName.ArrayCompact]: defaultDescriptor(FunctionName.ArrayCompact),

  [FunctionName.TextAll]: defaultDescriptor(FunctionName.TextAll),
  [FunctionName.RecordId]: defaultDescriptor(FunctionName.RecordId),
  [FunctionName.AutoNumber]: defaultDescriptor(FunctionName.AutoNumber),
};

export const getFormulaIndexabilityDescriptor = (
  functionName: FunctionName
): FormulaIndexabilityDescriptor => formulaIndexabilityDescriptors[functionName];

export const listFormulaIndexabilityDescriptors =
  (): ReadonlyArray<FormulaIndexabilityDescriptor> => Object.values(formulaIndexabilityDescriptors);

export const analyzeFormulaIndexability = (
  expression: FormulaExpression
): Result<FormulaAccessPathAnalysis, DomainError> => {
  const referencedFields = expression.getReferencedFieldIds();
  if (referencedFields.isErr()) return err(referencedFields.error);

  try {
    const tree = parseFormula(expression.toString());
    const calls = tree.accept(new FunctionCallCollectorVisitor());
    const predicatePushdown = tree.accept(new FormulaPredicatePushdownVisitor());
    const expressionIndexability = tree.accept(new FormulaExpressionIndexabilityVisitor());
    const functions = calls.map((call) => {
      const normalized = normalizeFunctionNameAlias(call.name) as FunctionName;
      const descriptorResult = formulaIndexabilityDescriptors[normalized];
      if (!descriptorResult) {
        return {
          name: normalized,
          paramCount: call.paramCount,
          descriptor: descriptor(normalized, {
            kind: 'none',
            stable: true,
            expressionIndexability: {
              supported: false,
              reason: 'unsupported_formula_function',
            },
            argumentRoles: ['unknown'],
            operatorFamilies: [],
            candidateIndexes: [],
            reason: 'unsupported_formula_function',
          }),
        };
      }
      return { name: normalized, paramCount: call.paramCount, descriptor: descriptorResult };
    });
    const stable = functions.every((call) => call.descriptor.stable);
    const sourceDescriptors = functions.filter((call) => call.descriptor.kind === 'source_field');
    const expressionDescriptors = functions.filter((call) => call.descriptor.kind === 'expression');
    const skippedReasons = uniqueStrings([
      ...functions
        .filter((call) => call.descriptor.kind === 'none' || !call.descriptor.stable)
        .map((call) => call.descriptor.reason ?? 'unsupported_formula_function'),
      ...(predicatePushdown?.skippedReasons ?? []),
    ]);
    const canPushDownPredicate =
      Boolean(predicatePushdown?.supported) && referencedFields.value.length === 1;
    const expressionIndexSkippedReasons = uniqueStrings([
      ...(expressionIndexability.supported ? [] : expressionIndexability.skippedReasons),
      ...(referencedFields.value.length === 0
        ? ['formula_expression_has_no_referenced_field']
        : []),
    ]);
    const expressionIndexable =
      stable && referencedFields.value.length > 0 && expressionIndexSkippedReasons.length === 0;
    const sourceKind =
      stable &&
      (canPushDownPredicate || sourceDescriptors.length > 0) &&
      referencedFields.value.length === 1
        ? 'formula_source'
        : stable && expressionDescriptors.length > 0
          ? 'formula_expression'
          : 'formula_result';

    return ok({
      referencedFieldIds: referencedFields.value.map((fieldId) => fieldId.toString()),
      functions,
      stable,
      sourceKind,
      operatorFamilies: uniqueStrings(
        functions
          .flatMap((call) => call.descriptor.operatorFamilies)
          .concat(predicatePushdown?.operatorFamilies ?? [])
      ) as FormulaIndexOperatorFamily[],
      candidateIndexes: uniqueStrings(
        functions
          .flatMap((call) => call.descriptor.candidateIndexes)
          .concat(predicatePushdown?.operatorFamilies.includes('text_contains') ? ['gin_trgm'] : [])
          .concat(expressionIndexable ? ['btree'] : [])
      ) as FormulaIndexCandidateKind[],
      skippedReasons,
      expressionIndexable,
      expressionIndexSkippedReasons,
      predicatePushdown,
    });
  } catch (error) {
    return ok({
      referencedFieldIds: referencedFields.value.map((fieldId) => fieldId.toString()),
      functions: [],
      stable: false,
      sourceKind: 'formula_result',
      operatorFamilies: [],
      candidateIndexes: [],
      skippedReasons: [
        error instanceof Error ? `formula_parse_failed:${error.message}` : 'formula_parse_failed',
      ],
      expressionIndexable: false,
      expressionIndexSkippedReasons: ['formula_parse_failed'],
    });
  }
};

type FormulaExpressionIndexabilityAnalysis = {
  readonly supported: boolean;
  readonly skippedReasons: readonly string[];
};

class FormulaExpressionIndexabilityVisitor
  extends AbstractParseTreeVisitor<FormulaExpressionIndexabilityAnalysis>
  implements FormulaVisitor<FormulaExpressionIndexabilityAnalysis>
{
  protected defaultResult(): FormulaExpressionIndexabilityAnalysis {
    return supportedExpressionIndexability();
  }

  visitRoot(ctx: RootContext): FormulaExpressionIndexabilityAnalysis {
    return ctx.expr().accept(this);
  }

  visitLeftWhitespaceOrComments(
    ctx: LeftWhitespaceOrCommentsContext
  ): FormulaExpressionIndexabilityAnalysis {
    return ctx.expr().accept(this);
  }

  visitRightWhitespaceOrComments(
    ctx: RightWhitespaceOrCommentsContext
  ): FormulaExpressionIndexabilityAnalysis {
    return ctx.expr().accept(this);
  }

  visitBrackets(ctx: BracketsContext): FormulaExpressionIndexabilityAnalysis {
    return ctx.expr().accept(this);
  }

  visitUnaryOp(ctx: UnaryOpContext): FormulaExpressionIndexabilityAnalysis {
    return ctx.expr().accept(this);
  }

  visitBinaryOp(ctx: BinaryOpContext): FormulaExpressionIndexabilityAnalysis {
    return mergeExpressionIndexability([ctx.expr(0).accept(this), ctx.expr(1).accept(this)]);
  }

  visitFunctionCall(ctx: FunctionCallContext): FormulaExpressionIndexabilityAnalysis {
    const functionName = normalizeFunctionNameAlias(
      ctx.func_name().text.toUpperCase()
    ) as FunctionName;
    const descriptorResult = formulaIndexabilityDescriptors[functionName];
    const ownReasons = descriptorResult
      ? [
          ...(descriptorResult.stable ? [] : [descriptorResult.reason ?? 'non_stable_formula']),
          ...(descriptorResult.expressionIndexability.supported
            ? []
            : [descriptorResult.expressionIndexability.reason]),
        ]
      : ['unsupported_formula_function'];
    const children = ctx.expr().map((expr) => expr.accept(this));
    return mergeExpressionIndexability([
      ownReasons.length === 0
        ? supportedExpressionIndexability()
        : {
            supported: false,
            skippedReasons: ownReasons,
          },
      ...children,
    ]);
  }
}

const supportedExpressionIndexability = (): FormulaExpressionIndexabilityAnalysis => ({
  supported: true,
  skippedReasons: [],
});

const mergeExpressionIndexability = (
  values: ReadonlyArray<FormulaExpressionIndexabilityAnalysis>
): FormulaExpressionIndexabilityAnalysis => {
  const skippedReasons = uniqueStrings(values.flatMap((value) => value.skippedReasons));
  return {
    supported: values.every((value) => value.supported) && skippedReasons.length === 0,
    skippedReasons,
  };
};

class FormulaPredicatePushdownVisitor
  extends AbstractParseTreeVisitor<FormulaPredicatePushdownAnalysis | undefined>
  implements FormulaVisitor<FormulaPredicatePushdownAnalysis | undefined>
{
  protected defaultResult(): FormulaPredicatePushdownAnalysis | undefined {
    return undefined;
  }

  visitRoot(ctx: RootContext): FormulaPredicatePushdownAnalysis | undefined {
    return ctx.expr().accept(this);
  }

  visitLeftWhitespaceOrComments(
    ctx: LeftWhitespaceOrCommentsContext
  ): FormulaPredicatePushdownAnalysis | undefined {
    return ctx.expr().accept(this);
  }

  visitRightWhitespaceOrComments(
    ctx: RightWhitespaceOrCommentsContext
  ): FormulaPredicatePushdownAnalysis | undefined {
    return ctx.expr().accept(this);
  }

  visitBrackets(ctx: BracketsContext): FormulaPredicatePushdownAnalysis | undefined {
    return ctx.expr().accept(this);
  }

  visitUnaryOp(ctx: UnaryOpContext): FormulaPredicatePushdownAnalysis | undefined {
    return ctx.expr().accept(this);
  }

  visitBinaryOp(ctx: BinaryOpContext): FormulaPredicatePushdownAnalysis | undefined {
    return ctx.expr(0).accept(this) ?? ctx.expr(1).accept(this);
  }

  visitFunctionCall(ctx: FunctionCallContext): FormulaPredicatePushdownAnalysis | undefined {
    const functionName = normalizeFunctionNameAlias(
      ctx.func_name().text.toUpperCase()
    ) as FunctionName;
    if (functionName !== FunctionName.If) {
      return ctx
        .expr()
        .reduce<
          FormulaPredicatePushdownAnalysis | undefined
        >((result, expr) => result ?? expr.accept(this), undefined);
    }

    const predicate = ctx.expr(0);
    if (!predicate) {
      return unsupportedPredicatePushdown();
    }

    const calls = predicate.accept(new FunctionCallCollectorVisitor());
    const predicateFunctions = uniqueStrings(
      calls
        .map((call) => normalizeFunctionNameAlias(call.name) as FunctionName)
        .filter((name) => Boolean(formulaIndexabilityDescriptors[name]))
    );
    const families = new Set<FormulaIndexOperatorFamily>();

    if (
      predicateFunctions.includes(FunctionName.Search) ||
      predicateFunctions.includes(FunctionName.Find)
    ) {
      families.add('text_contains');
    }
    if (
      predicateFunctions.includes(FunctionName.Left) ||
      predicateFunctions.includes(FunctionName.TextBefore)
    ) {
      families.add('text_prefix');
    }

    const binaryFamily = predicate.accept(new PredicateOperatorFamilyVisitor());
    if (binaryFamily) {
      families.add(binaryFamily);
    }

    if (families.size === 0) {
      return unsupportedPredicatePushdown();
    }

    return {
      supported: true,
      operatorFamilies: [...families],
      sourceFunctionNames: predicateFunctions,
      skippedReasons: [],
    };
  }
}

class PredicateOperatorFamilyVisitor
  extends AbstractParseTreeVisitor<FormulaIndexOperatorFamily | undefined>
  implements FormulaVisitor<FormulaIndexOperatorFamily | undefined>
{
  protected defaultResult(): FormulaIndexOperatorFamily | undefined {
    return undefined;
  }

  visitRoot(ctx: RootContext): FormulaIndexOperatorFamily | undefined {
    return ctx.expr().accept(this);
  }

  visitLeftWhitespaceOrComments(
    ctx: LeftWhitespaceOrCommentsContext
  ): FormulaIndexOperatorFamily | undefined {
    return ctx.expr().accept(this);
  }

  visitRightWhitespaceOrComments(
    ctx: RightWhitespaceOrCommentsContext
  ): FormulaIndexOperatorFamily | undefined {
    return ctx.expr().accept(this);
  }

  visitBrackets(ctx: BracketsContext): FormulaIndexOperatorFamily | undefined {
    return ctx.expr().accept(this);
  }

  visitUnaryOp(ctx: UnaryOpContext): FormulaIndexOperatorFamily | undefined {
    return ctx.expr().accept(this);
  }

  visitBinaryOp(ctx: BinaryOpContext): FormulaIndexOperatorFamily | undefined {
    if (ctx.EQUAL() || ctx.BANG_EQUAL()) {
      return 'equality';
    }
    if (ctx.GT() || ctx.GTE() || ctx.LT() || ctx.LTE()) {
      return 'range';
    }
    return ctx.expr(0).accept(this) ?? ctx.expr(1).accept(this);
  }
}

const unsupportedPredicatePushdown = (): FormulaPredicatePushdownAnalysis => ({
  supported: false,
  operatorFamilies: [],
  sourceFunctionNames: [],
  skippedReasons: ['predicate_pushdown_not_supported'],
});

const uniqueStrings = <T extends string>(values: Iterable<T>): T[] => [...new Set(values)];

export const assertAllFormulaFunctionsHaveIndexabilityDescriptors = (): Result<
  void,
  DomainError
> => {
  const missing = Object.values(FunctionName).filter(
    (functionName) => !formulaIndexabilityDescriptors[functionName]
  );
  if (missing.length > 0) {
    return err(
      domainError.validation({
        message: `Missing formula indexability descriptors: ${missing.join(', ')}`,
      })
    );
  }
  return ok(undefined);
};
