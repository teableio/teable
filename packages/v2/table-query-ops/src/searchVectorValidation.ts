export type SearchAccessPathValidationTiming = {
  readonly medianMs: number;
  readonly p95Ms: number;
};

export type SearchAccessPathValidationSample = {
  readonly legacyPath: SearchAccessPathValidationTiming;
  readonly candidatePath: SearchAccessPathValidationTiming;
  readonly exactResultMatch: boolean;
  readonly planEvidence: {
    readonly explainStatus: 'validated' | 'failed' | 'skipped';
    readonly costBefore?: number;
    readonly costAfter?: number;
    readonly usesGinIndex: boolean;
    readonly ginExpected: boolean;
  };
};

/** @deprecated Use SearchAccessPathValidationSample. */
export type SearchVectorValidationSample = SearchAccessPathValidationSample;

export const chooseSearchAccessPathValidationNextAction = (
  samples: readonly SearchAccessPathValidationSample[]
): 'ready_for_confirmation' | 'needs_plan_validation' | 'manual_investigation' => {
  if (!samples.length) return 'needs_plan_validation';
  if (samples.some((sample) => !sample.exactResultMatch)) return 'manual_investigation';

  const indexedSamples = samples.filter((sample) => sample.planEvidence.ginExpected);
  if (
    indexedSamples.some(
      (sample) =>
        sample.planEvidence.explainStatus !== 'validated' ||
        !sample.planEvidence.usesGinIndex ||
        typeof sample.planEvidence.costBefore !== 'number' ||
        typeof sample.planEvidence.costAfter !== 'number'
    )
  ) {
    return 'needs_plan_validation';
  }

  const hasMaterialPlanImprovement = indexedSamples.some(
    (sample) =>
      (sample.planEvidence.costAfter ?? Number.POSITIVE_INFINITY) <
      (sample.planEvidence.costBefore ?? Number.NEGATIVE_INFINITY)
  );
  const hasMaterialTimingRegression = samples.some(
    (sample) =>
      sample.legacyPath.medianMs > 0 &&
      sample.candidatePath.medianMs > sample.legacyPath.medianMs * 1.2
  );

  return hasMaterialPlanImprovement && !hasMaterialTimingRegression
    ? 'ready_for_confirmation'
    : 'manual_investigation';
};

/** @deprecated Use chooseSearchAccessPathValidationNextAction. */
export const chooseSearchVectorValidationNextAction = chooseSearchAccessPathValidationNextAction;
