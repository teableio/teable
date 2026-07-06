export type TableQueryOpsIndexNextAction =
  | 'ready_for_confirmation'
  | 'no_index_change'
  | 'candidate_not_recommended'
  | 'needs_plan_validation'
  | 'manual_investigation';

export interface IndexSetPlannerField {
  readonly fieldId?: string;
  readonly fieldDbName?: string;
  readonly direction?: 'asc' | 'desc';
  readonly role?: string;
  readonly sourceKind?: 'direct_field' | 'formula_result' | 'formula_source' | 'formula_expression';
  readonly formulaFieldId?: string;
  readonly formulaFunctionNames?: readonly string[];
  readonly formulaSkippedReasons?: readonly string[];
  readonly formulaPredicatePushdown?: {
    readonly supported: boolean;
    readonly operatorFamilies: readonly string[];
    readonly sourceFunctionNames: readonly string[];
    readonly skippedReasons: readonly string[];
  };
}

export interface IndexSetPlannerCandidate {
  readonly candidateId: string;
  readonly indexName?: string;
  readonly indexKind: string;
  readonly accessPath: string;
  readonly indexStructure: string;
  readonly fields: readonly IndexSetPlannerField[];
  readonly coveredSourceIds: readonly string[];
  readonly coveredQueryKinds: readonly string[];
  readonly coveredShapeHashes: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly riskLevels: readonly string[];
  readonly explainStatus?: 'validated' | 'skipped' | 'failed';
  readonly explainCostBefore?: number;
  readonly explainCostAfter?: number;
  readonly explainCostDelta?: number;
  readonly explainCostDeltaPct?: number;
  readonly plannerUsedIndex?: boolean;
  readonly nextAction?: string;
}

export interface IndexSetPlannerOptions {
  readonly minCostImprovementPct?: number;
  readonly minAbsoluteCostImprovement?: number;
  readonly lowCostBeforeThreshold?: number;
}

export interface RecommendedIndexSetItem extends IndexSetPlannerCandidate {
  readonly nextAction: TableQueryOpsIndexNextAction;
  readonly coveredCandidateIds: readonly string[];
  readonly rejectedCandidateIds: readonly string[];
}

export interface RejectedIndexCandidate {
  readonly candidate: IndexSetPlannerCandidate;
  readonly nextAction: TableQueryOpsIndexNextAction;
  readonly rejectionReason: string;
  readonly coveredByCandidateId?: string;
}

export interface RecommendedIndexSet {
  readonly recommendedIndexSet: readonly RecommendedIndexSetItem[];
  readonly rejectedCandidates: readonly RejectedIndexCandidate[];
}

const DEFAULT_MIN_COST_IMPROVEMENT_PCT = 20;
const DEFAULT_MIN_ABSOLUTE_COST_IMPROVEMENT = 1;
const DEFAULT_LOW_COST_BEFORE_THRESHOLD = 5;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const fieldIdentity = (field: IndexSetPlannerField): string =>
  field.fieldDbName ?? field.fieldId ?? 'unknown_field';

const canonicalFieldSetKey = (candidate: IndexSetPlannerCandidate): string =>
  [candidate.indexKind, candidate.fields.map(fieldIdentity).filter(Boolean).sort().join('|')].join(
    ':'
  );

const costDelta = (candidate: IndexSetPlannerCandidate): number | undefined => {
  if (isFiniteNumber(candidate.explainCostDelta)) return candidate.explainCostDelta;
  if (isFiniteNumber(candidate.explainCostBefore) && isFiniteNumber(candidate.explainCostAfter)) {
    return candidate.explainCostAfter - candidate.explainCostBefore;
  }
  return undefined;
};

const costDeltaPct = (candidate: IndexSetPlannerCandidate): number | undefined => {
  if (isFiniteNumber(candidate.explainCostDeltaPct)) return candidate.explainCostDeltaPct;
  const delta = costDelta(candidate);
  if (!isFiniteNumber(delta) || !isFiniteNumber(candidate.explainCostBefore)) return undefined;
  if (candidate.explainCostBefore <= 0) return undefined;
  return Number(((delta / candidate.explainCostBefore) * 100).toFixed(2));
};

const classifyCandidate = (
  candidate: IndexSetPlannerCandidate,
  options: Required<IndexSetPlannerOptions>
): { readonly nextAction: TableQueryOpsIndexNextAction; readonly reason?: string } => {
  if (candidate.nextAction === 'no_index_change') {
    return { nextAction: 'no_index_change', reason: 'existing_index_sufficient' };
  }

  if (candidate.explainStatus !== 'validated') {
    return {
      nextAction:
        candidate.explainStatus === 'failed' ? 'manual_investigation' : 'needs_plan_validation',
      reason:
        candidate.explainStatus === 'failed' ? 'plan_validation_failed' : 'plan_validation_missing',
    };
  }

  if (candidate.plannerUsedIndex !== true) {
    return { nextAction: 'candidate_not_recommended', reason: 'planner_did_not_use_index' };
  }

  const before = candidate.explainCostBefore;
  const delta = costDelta(candidate);
  const deltaPct = costDeltaPct(candidate);
  if (!isFiniteNumber(before) || !isFiniteNumber(delta) || !isFiniteNumber(deltaPct)) {
    return { nextAction: 'needs_plan_validation', reason: 'plan_cost_missing' };
  }
  if (delta >= 0) {
    return { nextAction: 'candidate_not_recommended', reason: 'cost_not_improved' };
  }

  const absoluteImprovement = Math.abs(delta);
  const relativeImprovement = Math.abs(deltaPct);
  if (
    before <= options.lowCostBeforeThreshold &&
    absoluteImprovement < options.minAbsoluteCostImprovement
  ) {
    return { nextAction: 'manual_investigation', reason: 'low_absolute_cost_improvement' };
  }
  if (relativeImprovement < options.minCostImprovementPct) {
    return { nextAction: 'manual_investigation', reason: 'low_relative_cost_improvement' };
  }
  return { nextAction: 'ready_for_confirmation' };
};

const improvementScore = (candidate: IndexSetPlannerCandidate): number => {
  const delta = costDelta(candidate);
  return isFiniteNumber(delta) && delta < 0 ? Math.abs(delta) : 0;
};

const relativeImprovementScore = (candidate: IndexSetPlannerCandidate): number => {
  const deltaPct = costDeltaPct(candidate);
  return isFiniteNumber(deltaPct) && deltaPct < 0 ? Math.abs(deltaPct) : 0;
};

const sourceCount = (candidate: IndexSetPlannerCandidate): number =>
  new Set(candidate.coveredSourceIds).size;

const compareCandidates = (
  left: IndexSetPlannerCandidate,
  right: IndexSetPlannerCandidate
): number => {
  const sourceDelta = sourceCount(right) - sourceCount(left);
  if (sourceDelta !== 0) return sourceDelta;

  const improvementDelta = improvementScore(right) - improvementScore(left);
  if (improvementDelta !== 0) return improvementDelta;

  const relativeDelta = relativeImprovementScore(right) - relativeImprovementScore(left);
  if (relativeDelta !== 0) return relativeDelta;

  const fieldDelta = right.fields.length - left.fields.length;
  if (fieldDelta !== 0) return fieldDelta;

  return left.candidateId.localeCompare(right.candidateId);
};

export const planRecommendedIndexSet = (
  candidates: readonly IndexSetPlannerCandidate[],
  inputOptions: IndexSetPlannerOptions = {}
): RecommendedIndexSet => {
  const options: Required<IndexSetPlannerOptions> = {
    minCostImprovementPct: inputOptions.minCostImprovementPct ?? DEFAULT_MIN_COST_IMPROVEMENT_PCT,
    minAbsoluteCostImprovement:
      inputOptions.minAbsoluteCostImprovement ?? DEFAULT_MIN_ABSOLUTE_COST_IMPROVEMENT,
    lowCostBeforeThreshold:
      inputOptions.lowCostBeforeThreshold ?? DEFAULT_LOW_COST_BEFORE_THRESHOLD,
  };

  const rejected: RejectedIndexCandidate[] = [];
  const readyGroups = new Map<string, IndexSetPlannerCandidate[]>();

  for (const candidate of candidates) {
    const classification = classifyCandidate(candidate, options);
    if (classification.nextAction !== 'ready_for_confirmation') {
      rejected.push({
        candidate,
        nextAction: classification.nextAction,
        rejectionReason: classification.reason ?? classification.nextAction,
      });
      continue;
    }
    const key = canonicalFieldSetKey(candidate);
    readyGroups.set(key, [...(readyGroups.get(key) ?? []), candidate]);
  }

  const recommended: RecommendedIndexSetItem[] = [];
  for (const group of readyGroups.values()) {
    const [winner, ...covered] = [...group].sort(compareCandidates);
    if (!winner) continue;

    for (const coveredCandidate of covered) {
      rejected.push({
        candidate: coveredCandidate,
        nextAction: 'candidate_not_recommended',
        rejectionReason: 'covered_by_better_index_candidate',
        coveredByCandidateId: winner.candidateId,
      });
    }

    recommended.push({
      ...winner,
      nextAction: 'ready_for_confirmation',
      coveredCandidateIds: [winner.candidateId, ...covered.map((item) => item.candidateId)],
      rejectedCandidateIds: covered.map((item) => item.candidateId),
    });
  }

  return {
    recommendedIndexSet: recommended.sort(compareCandidates),
    rejectedCandidates: rejected.sort((left, right) =>
      left.candidate.candidateId.localeCompare(right.candidate.candidateId)
    ),
  };
};
