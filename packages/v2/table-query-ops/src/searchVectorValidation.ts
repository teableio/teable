export type SearchVectorValidationSample = {
  readonly defaultPath: { readonly durationMs: number };
  readonly generatedTsvectorPath: { readonly durationMs: number };
  readonly planEvidence: {
    readonly explainStatus: 'validated' | 'failed';
    readonly costBefore?: number;
    readonly costAfter?: number;
    readonly usesGinIndex: boolean;
    readonly ginExpected: boolean;
  };
  readonly llmReasonableness:
    | 'reasonable'
    | 'semantic_drift'
    | 'needs_language_config'
    | 'manual_review';
};

export const chooseSearchVectorValidationNextAction = (
  samples: readonly SearchVectorValidationSample[]
):
  | 'ready_for_confirmation'
  | 'needs_language_config'
  | 'needs_plan_validation'
  | 'manual_investigation' => {
  const hasUnvalidatedPlan = samples.some(
    (sample) => sample.planEvidence.explainStatus !== 'validated'
  );
  const hasMissingSelectiveGin = samples.some(
    (sample) => sample.planEvidence.ginExpected && !sample.planEvidence.usesGinIndex
  );
  if (hasUnvalidatedPlan || hasMissingSelectiveGin) return 'needs_plan_validation';

  if (
    samples.some((sample) =>
      ['semantic_drift', 'needs_language_config'].includes(sample.llmReasonableness)
    )
  ) {
    return 'needs_language_config';
  }

  const allSamplesImprovedCost = samples.every(
    (sample) =>
      typeof sample.planEvidence.costBefore === 'number' &&
      typeof sample.planEvidence.costAfter === 'number' &&
      sample.planEvidence.costAfter < sample.planEvidence.costBefore
  );
  const allSamplesImprovedDuration = samples.every(
    (sample) => sample.generatedTsvectorPath.durationMs < sample.defaultPath.durationMs
  );
  return allSamplesImprovedCost && allSamplesImprovedDuration
    ? 'ready_for_confirmation'
    : 'manual_investigation';
};
