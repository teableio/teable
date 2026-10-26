import type { EstimatedRange, PathDataEstimate } from './ComplexityDataEstimate';
import type {
  OperationRiskFlag,
  PathBeforeImage,
  PropagationCertainty,
  PropagationMode,
  SchemaComplexityProfile,
} from './ComplexityProfile';

export const COMPLEXITY_POLICY_VERSION = 'v2-complexity-policy-2' as const;

export type ComplexityLevel = 'unknown' | 'trivial' | 'low' | 'medium' | 'high' | 'critical';
export type ComplexityAssessmentConfidence = 'high' | 'medium' | 'low';

export type ComplexityWorkloadStatus = 'estimated' | 'bounded' | 'unknown';

export type ComplexityShare = {
  /** path work expected / total workload expected; null if either is unknown or total is 0. */
  readonly typicalShare: number | null;
  /** path work upper bound / total workload upper bound; null if either upper is unknown or total is 0. */
  readonly worstCaseShare: number | null;
  readonly warnings: ReadonlyArray<string>;
};

export type ComplexityModeBreakdown = {
  readonly mode: PropagationMode;
  readonly pathCount: number;
  readonly scan: EstimatedRange;
  readonly dirty: EstimatedRange;
  readonly estimatedWrites: EstimatedRange;
  readonly workRows: EstimatedRange;
  readonly share: ComplexityShare;
};

export type ComplexityPathBreakdown = {
  readonly mode: PropagationMode;
  readonly fromFieldId: string;
  readonly toFieldId: string;
  readonly fromTableId: string;
  readonly toTableId: string;
  readonly linkFieldId: string | null;
  readonly level: number;
  readonly beforeImage: PathBeforeImage;
  readonly alternativeGroup: string | null;
  readonly certainty: PropagationCertainty;
  readonly scan: EstimatedRange;
  readonly dirty: EstimatedRange;
  readonly estimatedWrites: EstimatedRange;
  readonly workRows: EstimatedRange;
  readonly share: ComplexityShare;
};

/** Path/mode explanation. Shares are against the workload rows, not distinct rows. */
export type ComplexityWorkloadBreakdown = {
  readonly modes: ReadonlyArray<ComplexityModeBreakdown>;
  readonly paths: ReadonlyArray<ComplexityPathBreakdown>;
  readonly shareBasis: 'path-work';
};

/**
 * Workload is the operational conclusion and the only source of `level`.
 * `rows` is the max across path work from the topological propagation frontier:
 * `max(pathWork.scan, pathWork.dirty)`, never record fanout or path multiplicity.
 */
export type ComplexityWorkload = {
  readonly status: ComplexityWorkloadStatus;
  readonly rows: EstimatedRange;
  readonly typicalLevel: ComplexityLevel;
  readonly worstCaseLevel: ComplexityLevel;
  /** Compatibility alias: worst-case level. */
  readonly level: ComplexityLevel;
  readonly basis: 'max-scan-dirty';
  readonly warnings: ReadonlyArray<string>;
};

/**
 * Policy-index assessment plus a workload-primary level.
 *
 * `score` is a nullable ranking index for sorting comparable assessments. It
 * never determines `level` and is null whenever required data dimensions are
 * unknown, because a partial index cannot be compared with a complete one.
 */
export type ComplexityAssessment = {
  readonly policyVersion: typeof COMPLEXITY_POLICY_VERSION;
  /** Same value as `workload.level`; level never comes from `score`. */
  readonly level: ComplexityLevel;
  /** Sort-only policy index; null when required data dimensions are unknown. */
  readonly score: number | null;
  readonly headline: string;
  readonly workload: ComplexityWorkload;
  readonly breakdown: ComplexityWorkloadBreakdown;
  readonly components: {
    readonly structural: number;
    /** Null when any required data dimension (scan, dirty, writes) is unknown. */
    readonly dataWork: number | null;
    readonly risk: number;
  };
  /** Deduplicated machine-readable risk codes, highest severity first. */
  readonly reasonCodes: ReadonlyArray<string>;
  readonly recommendations: ReadonlyArray<string>;
  readonly confidence: ComplexityAssessmentConfidence;
};

type ComponentWeights = {
  readonly structural: number;
  readonly dataWork: number;
  readonly risk: number;
};

type RiskSeverity = 'low' | 'medium' | 'high';

type RiskSignal = {
  readonly code: string;
  readonly severity: RiskSeverity;
  readonly message: string;
};

/** Sort-only policy score weights. These weights never determine workload level. */
const WEIGHTS: ComponentWeights = {
  structural: 0.4,
  dataWork: 0.4,
  risk: 0.2,
};

/** Workload level boundaries in rows. Equality belongs to the higher level. */
const WORKLOAD_THRESHOLDS = {
  low: 1_000,
  medium: 100_000,
  high: 1_000_000,
} as const;

const RISK_SEVERITY_WEIGHT: Readonly<Record<RiskSeverity, number>> = {
  low: 5,
  medium: 12,
  high: 25,
};

const clampScore = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));

const ratio = (value: number, denominator: number): number =>
  denominator <= 0 ? 0 : Math.min(1, value / denominator);

const logScore = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(100, Math.round((100 * Math.log10(1 + value)) / 7));
};

const isKnown = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

const rangeWithStatus = (input: {
  readonly expected: number | null;
  readonly lower: number | null;
  readonly upper: number | null;
}): EstimatedRange => ({
  status:
    input.expected !== null
      ? 'estimated'
      : input.lower !== null || input.upper !== null
        ? 'bounded'
        : 'unknown',
  expected: input.expected,
  lower: input.lower,
  upper: input.upper,
});

const UNKNOWN_RANGE = rangeWithStatus({ expected: null, lower: null, upper: null });

const levelForRows = (rows: number): Exclude<ComplexityLevel, 'unknown'> => {
  if (!Number.isFinite(rows) || rows <= 0) return 'trivial';
  if (rows < WORKLOAD_THRESHOLDS.low) return 'low';
  if (rows < WORKLOAD_THRESHOLDS.medium) return 'medium';
  if (rows < WORKLOAD_THRESHOLDS.high) return 'high';
  return 'critical';
};

const structuralScore = (profile: SchemaComplexityProfile): number => {
  const structural = profile.structural;
  const depth = structural.maxDependencyDepth;
  const depthScore =
    depth === null
      ? structural.depthStatus === 'cycle' || structural.depthStatus === 'truncated'
        ? 100
        : logScore(structural.graphNodeCount)
      : ratio(depth, 12) * 100;
  const density = ratio(structural.edgeCount, Math.max(1, structural.fieldCount));
  const outDegree = ratio(structural.maxUniqueOutDegree, 8);
  const inDegree = ratio(structural.maxUniqueInDegree, 8);
  const crossRecord = ratio(structural.crossRecordEdgeCount, Math.max(1, structural.edgeCount));
  const conditional = ratio(structural.conditionalEdgeCount, Math.max(1, structural.edgeCount));

  return clampScore(
    depthScore * 0.35 +
      density * 100 * 0.2 +
      outDegree * 100 * 0.15 +
      inDegree * 100 * 0.1 +
      crossRecord * 100 * 0.1 +
      conditional * 100 * 0.1
  );
};

type DataWorkComponent = {
  readonly score: number | null;
  readonly reasonCodes: ReadonlyArray<string>;
};

/**
 * Data work is only scored when scan, dirty and writes are all known. Unknown
 * writes must never be scored as zero: null means "not estimated", not "none".
 */
const dataWorkComponent = (profile: SchemaComplexityProfile): DataWorkComponent => {
  const estimate = profile.dataEstimate;
  if (!estimate || estimate.status === 'not-estimated') {
    return { score: null, reasonCodes: ['data-work-not-estimated'] };
  }

  const reasonCodes: string[] = [];
  if (estimate.status === 'partial') reasonCodes.push('data-estimate-partial');

  const dirty = estimate.totals.pathWork.dirty.expected;
  const scan = estimate.totals.pathWork.scan.expected;
  const writes = estimate.totals.pathWork.estimatedWrites.expected;

  if (dirty === null) reasonCodes.push('data-work-dirty-unknown');
  if (scan === null) reasonCodes.push('data-work-scan-unknown');
  if (writes === null) reasonCodes.push('data-work-writes-unknown');

  if (dirty === null || scan === null || writes === null) {
    return { score: null, reasonCodes };
  }

  return {
    score: clampScore(logScore(dirty) * 0.7 + logScore(scan) * 0.2 + logScore(writes) * 0.1),
    reasonCodes,
  };
};

const buildWorkload = (profile: SchemaComplexityProfile): ComplexityWorkload => {
  const scan = profile.dataEstimate?.totals.distinct.scan ?? UNKNOWN_RANGE;
  // Dirty is the distinct-row view; path multiplicity must not raise the level.
  const dirty = profile.dataEstimate?.totals.distinct.dirty ?? UNKNOWN_RANGE;
  const warnings: string[] = [];

  const expected =
    isKnown(scan.expected) && isKnown(dirty.expected)
      ? Math.max(scan.expected, dirty.expected)
      : null;
  const knownLowers = [scan.lower, dirty.lower].filter(isKnown);
  const lower = knownLowers.length === 0 ? null : Math.max(...knownLowers);
  const upper =
    isKnown(scan.upper) && isKnown(dirty.upper) ? Math.max(scan.upper, dirty.upper) : null;

  const derivedExpected =
    expected ??
    (lower !== null && upper !== null && lower === upper ? lower : null);
  const consistent = lower === null || upper === null || lower <= upper;
  if (!consistent) warnings.push('workload-range-inconsistent');

  const rows = rangeWithStatus({
    expected: derivedExpected,
    lower: consistent ? lower : null,
    upper: consistent ? upper : null,
  });
  if (rows.status === 'unknown') warnings.push('workload-unknown');

  const typicalLevel: ComplexityLevel =
    rows.expected === null ? 'unknown' : levelForRows(rows.expected);
  const worstCaseLevel: ComplexityLevel =
    rows.upper !== null
      ? levelForRows(rows.upper)
      : rows.expected !== null
        ? levelForRows(rows.expected)
        : rows.lower !== null
          ? levelForRows(rows.lower)
          : 'unknown';
  const level = worstCaseLevel;
  if (rows.upper !== null && (rows.expected === null || rows.upper > rows.expected)) {
    warnings.push('workload-level-from-upper-bound');
  } else if (rows.lower !== null && rows.expected === null && rows.upper === null) {
    warnings.push('workload-level-from-lower-bound');
  }

  return {
    status: rows.status,
    rows,
    typicalLevel,
    worstCaseLevel,
    level,
    basis: 'max-scan-dirty',
    warnings: [...new Set(warnings)].sort((left, right) => left.localeCompare(right)),
  };
};

const combineRanges = (ranges: ReadonlyArray<EstimatedRange>): EstimatedRange => {
  if (ranges.length === 0) return UNKNOWN_RANGE;
  const expectedKnown = ranges.every((range) => range.expected !== null);
  const upperKnown = ranges.every((range) => range.upper !== null);
  const expected = expectedKnown
    ? ranges.reduce((sum, range) => sum + (range.expected ?? 0), 0)
    : null;
  const lowerKnown = ranges
    .map((range) => range.lower)
    .filter((value): value is number => value !== null);
  const lower = lowerKnown.length
    ? lowerKnown.reduce((sum, value) => sum + value, 0)
    : null;
  const upper = upperKnown
    ? ranges.reduce((sum, range) => sum + (range.upper ?? 0), 0)
    : null;
  return rangeWithStatus({ expected, lower, upper });
};

const maxRange = (ranges: ReadonlyArray<EstimatedRange>): EstimatedRange => {
  if (ranges.length === 0) return UNKNOWN_RANGE;
  const expected = ranges.every((range) => range.expected !== null)
    ? Math.max(...ranges.map((range) => range.expected ?? 0))
    : null;
  const lowerKnown = ranges
    .map((range) => range.lower)
    .filter((value): value is number => value !== null);
  const upper = ranges.every((range) => range.upper !== null)
    ? Math.max(...ranges.map((range) => range.upper ?? 0))
    : null;
  return rangeWithStatus({
    expected,
    lower: lowerKnown.length ? Math.max(...lowerKnown) : null,
    upper,
  });
};

const workRows = (scan: EstimatedRange, dirty: EstimatedRange): EstimatedRange =>
  rangeWithStatus({
    expected:
      scan.expected !== null && dirty.expected !== null
        ? Math.max(scan.expected, dirty.expected)
        : null,
    lower:
      scan.lower !== null && dirty.lower !== null ? Math.max(scan.lower, dirty.lower) : null,
    upper:
      scan.upper !== null && dirty.upper !== null ? Math.max(scan.upper, dirty.upper) : null,
  });

const shareOf = (
  value: EstimatedRange,
  total: EstimatedRange
): ComplexityShare => {
  const warnings: string[] = [];
  const typicalShare =
    value.expected !== null && total.expected !== null && total.expected > 0
      ? value.expected / total.expected
      : null;
  if (value.expected === null || total.expected === null) {
    warnings.push('share-expected-unknown');
  } else if (total.expected === 0) {
    warnings.push('share-zero-total');
  }
  const worstCaseShare =
    value.upper !== null && total.upper !== null && total.upper > 0
      ? value.upper / total.upper
      : null;
  if (value.upper === null || total.upper === null) {
    warnings.push('share-upper-unknown');
  } else if (total.upper === 0) {
    warnings.push('share-zero-total');
  }
  return { typicalShare, worstCaseShare, warnings: [...new Set(warnings)].sort() };
};

const aggregatePaths = (paths: ReadonlyArray<PathDataEstimate>): {
  scan: EstimatedRange;
  dirty: EstimatedRange;
  estimatedWrites: EstimatedRange;
} => {
  const independent: PathDataEstimate[] = [];
  const groups = new Map<string, PathDataEstimate[]>();
  for (const path of paths) {
    if (path.alternativeGroup === null) independent.push(path);
    else {
      const group = groups.get(path.alternativeGroup) ?? [];
      group.push(path);
      groups.set(path.alternativeGroup, group);
    }
  }
  const grouped = [...groups.values()].map((group) => ({
    scan: maxRange(group.map((path) => path.scan)),
    dirty: maxRange(group.map((path) => path.dirty)),
    estimatedWrites: maxRange(group.map((path) => path.estimatedWrites)),
  }));
  return {
    scan: combineRanges([...independent.map((path) => path.scan), ...grouped.map((g) => g.scan)]),
    dirty: combineRanges([...independent.map((path) => path.dirty), ...grouped.map((g) => g.dirty)]),
    estimatedWrites: combineRanges([
      ...independent.map((path) => path.estimatedWrites),
      ...grouped.map((g) => g.estimatedWrites),
    ]),
  };
};

const buildWorkloadBreakdown = (
  profile: SchemaComplexityProfile
): ComplexityWorkloadBreakdown => {
  const paths = profile.dataEstimate?.paths ?? [];
  const pathWorkTotals = profile.dataEstimate?.totals.pathWork;
  const totalPathWork = pathWorkTotals
    ? workRows(pathWorkTotals.scan, pathWorkTotals.dirty)
    : UNKNOWN_RANGE;
  const modes = (
    ['sameRecord', 'linkTraversal', 'conditionalFiltered', 'allTargetRecords', 'backfill'] as const
  ).map((mode): ComplexityModeBreakdown => {
    const group = paths.filter((path) => path.mode === mode);
    const aggregate = aggregatePaths(group);
    const modeWork = workRows(aggregate.scan, aggregate.dirty);
    return {
      mode,
      pathCount: group.length,
      ...aggregate,
      workRows: modeWork,
      share: shareOf(modeWork, totalPathWork),
    };
  });
  return {
    modes,
    paths: paths.map((path): ComplexityPathBreakdown => {
      const pathWork = workRows(path.scan, path.dirty);
      return {
        mode: path.mode,
        fromFieldId: path.fromFieldId,
        toFieldId: path.toFieldId,
        fromTableId: path.fromTableId,
        toTableId: path.toTableId,
        linkFieldId: path.linkFieldId,
        level: path.level,
        beforeImage: path.beforeImage,
        alternativeGroup: path.alternativeGroup,
        certainty: path.certainty,
        scan: path.scan,
        dirty: path.dirty,
        estimatedWrites: path.estimatedWrites,
        workRows: pathWork,
        share: shareOf(pathWork, totalPathWork),
      };
    }),
    shareBasis: 'path-work',
  };
};

const severityOrder: Readonly<Record<RiskSeverity, number>> = {
  high: 3,
  medium: 2,
  low: 1,
};

const createRiskCollector = () => {
  const risks = new Map<string, RiskSignal>();
  return {
    add(code: string, severity: RiskSeverity, message: string) {
      const existing = risks.get(code);
      if (!existing || severityOrder[severity] > severityOrder[existing.severity]) {
        risks.set(code, { code, severity, message });
      }
    },
    all(): ReadonlyArray<RiskSignal> {
      return [...risks.values()].sort(
        (left, right) =>
          severityOrder[right.severity] - severityOrder[left.severity] ||
          left.code.localeCompare(right.code)
      );
    },
  };
};

const riskFlagSeverity: Readonly<Partial<Record<OperationRiskFlag, RiskSeverity>>> = {
  'conditional-all-target-possible': 'high',
  'conditional-before-image-unknown': 'medium',
  'conditional-target-backfill': 'medium',
  'dependency-cycle': 'high',
  'empty-changed-fields': 'low',
  'field-change-without-field-change': 'low',
  'field-delete-no-backfill': 'low',
  'field-delete-work-unknown': 'medium',
  'field-convert-work-unknown': 'medium',
  'invalid-max-traversal-depth': 'medium',
  'missing-condition-metadata': 'medium',
  'missing-link-metadata': 'medium',
  'planner-before-image-missing': 'low',
  'planner-seed-all-tables': 'high',
  'planner-shape-truncated': 'high',
  'record-delete-schema-potential-unavailable': 'medium',
  'schema-partial': 'low',
  'schema-truncated': 'high',
  'traversal-truncated': 'high',
  'unknown-changed-field': 'medium',
  'unknown-operation-table': 'medium',
  'unresolved-field-metadata': 'medium',
};

const collectRisks = (
  profile: SchemaComplexityProfile,
  dataWork: DataWorkComponent
): ReadonlyArray<RiskSignal> => {
  const collector = createRiskCollector();
  const structural = profile.structural;

  if (structural.cycleFieldIds.length > 0) {
    collector.add(
      'dependency-cycle',
      'high',
      `Dependency cycle contains ${structural.cycleFieldIds.length} field(s).`
    );
  }
  if (structural.depthStatus === 'truncated') {
    collector.add('depth-truncated', 'high', 'Dependency depth was truncated.');
  }
  if (structural.effectiveCompleteness === 'partial') {
    collector.add('schema-partial', 'low', 'Schema metadata is partial.');
  }
  if (structural.effectiveCompleteness === 'truncated') {
    collector.add('schema-truncated', 'high', 'Schema metadata was truncated.');
  }
  if (structural.unresolvedFieldIds.length > 0) {
    collector.add(
      'unresolved-fields',
      'medium',
      `${structural.unresolvedFieldIds.length} field id(s) are referenced but unresolved.`
    );
  }
  if (structural.missingMetadata.computedFieldsWithoutFormula.length > 0) {
    collector.add(
      'computed-without-formula',
      'medium',
      `${structural.missingMetadata.computedFieldsWithoutFormula.length} computed field(s) lack formula metadata.`
    );
  }

  for (const flag of profile.operation?.riskFlags ?? []) {
    collector.add(flag, riskFlagSeverity[flag] ?? 'medium', `Operation risk: ${flag}.`);
  }
  if (profile.operation?.uncertainty === 'unknown') {
    collector.add(
      'operation-work-unknown',
      'medium',
      'Operation work cannot be bounded without a planner plan or equivalent metadata.'
    );
  }

  for (const formula of profile.formulas) {
    if (formula.profile.status === 'invalid') {
      collector.add('invalid-formula', 'high', 'At least one formula could not be parsed.');
    } else if (formula.profile.status === 'truncated') {
      collector.add('truncated-formula', 'medium', 'At least one formula profile was truncated.');
    }
    if (formula.profile.contextFree) {
      collector.add(
        'context-free-formula',
        'medium',
        'A formula has no explicit field reference and may still depend on record/time context.'
      );
    }
  }

  const dataReasonSeverity: Readonly<Record<string, RiskSeverity>> = {
    'data-work-not-estimated': 'medium',
    'data-estimate-partial': 'low',
    'data-work-dirty-unknown': 'medium',
    'data-work-scan-unknown': 'medium',
    'data-work-writes-unknown': 'medium',
  };
  for (const code of dataWork.reasonCodes) {
    collector.add(code, dataReasonSeverity[code] ?? 'medium', `Data estimate: ${code}.`);
  }

  return collector.all();
};

const recommendationsFor = (input: {
  readonly risks: ReadonlyArray<RiskSignal>;
  readonly structural: number;
  readonly workload: ComplexityWorkload;
  readonly dataWork: number | null;
}): ReadonlyArray<string> => {
  const recommendations = new Set<string>();
  const riskCodes = new Set(input.risks.map((risk) => risk.code));

  if (riskCodes.has('dependency-cycle')) {
    recommendations.add('Break the dependency cycle before relying on propagation estimates.');
  }
  if (
    riskCodes.has('conditional-all-target-possible') ||
    riskCodes.has('conditional-before-image-unknown')
  ) {
    recommendations.add(
      'Provide before-image/selectivity assumptions or validate the conditional target with catalog statistics.'
    );
  }
  if (riskCodes.has('schema-truncated') || riskCodes.has('depth-truncated')) {
    recommendations.add('Increase traversal limits and re-run on a complete schema snapshot.');
  }
  if (riskCodes.has('computed-without-formula')) {
    recommendations.add('Load formula sources for computed fields to measure formula work.');
  }
  if (riskCodes.has('invalid-formula')) {
    recommendations.add('Fix invalid formulas before relying on the formula component.');
  }
  if (
    riskCodes.has('field-convert-work-unknown') ||
    riskCodes.has('field-delete-work-unknown') ||
    riskCodes.has('operation-work-unknown')
  ) {
    recommendations.add(
      'Attach a planner plan for field convert/delete so the affected work can be bounded.'
    );
  }
  if (input.dataWork === null) {
    recommendations.add(
      'Pass caller assumptions or use tableId + includeCatalogStats to estimate data work.'
    );
  }
  if (input.workload.status === 'unknown') {
    recommendations.add(
      'Provide scan and dirty row statistics before treating this assessment as a workload level.'
    );
  }
  if (input.workload.level === 'critical') {
    recommendations.add(
      'Plan a bounded/batched rollout; estimated scan or dirty rows reach the critical threshold.'
    );
  }
  if (input.structural >= 60) {
    recommendations.add(
      'Inspect the longest dependency chain and split or flatten it where possible.'
    );
  }

  if (recommendations.size === 0) {
    recommendations.add(
      'No dominant risk detected; validate with catalog statistics or caller assumptions before rollout.'
    );
  }

  return [...recommendations].slice(0, 6);
};

const assessmentConfidence = (
  profile: SchemaComplexityProfile,
  dataWork: DataWorkComponent
): ComplexityAssessmentConfidence => {
  const data = profile.dataEstimate;
  const completeness = profile.structural.effectiveCompleteness;
  const hasInvalidFormula = profile.formulas.some((entry) => entry.profile.status === 'invalid');

  if (
    completeness !== 'complete' ||
    hasInvalidFormula ||
    data === undefined ||
    data.status !== 'estimated' ||
    dataWork.score === null ||
    data.confidence === 'low' ||
    profile.operation?.uncertainty === 'unknown'
  ) {
    return 'low';
  }
  return data.confidence === 'high' ? 'high' : 'medium';
};

const describeRows = (rows: EstimatedRange): string => {
  if (rows.expected !== null) return `${rows.expected} rows expected`;
  if (rows.lower !== null && rows.upper !== null) {
    return `rows ${rows.lower}..${rows.upper} (expected unknown)`;
  }
  if (rows.lower !== null) return `at least ${rows.lower} rows`;
  if (rows.upper !== null) return `at most ${rows.upper} rows`;
  return 'rows unknown';
};

const headlineFor = (input: {
  readonly profile: SchemaComplexityProfile;
  readonly level: ComplexityLevel;
  readonly score: number | null;
  readonly structural: number;
  readonly workload: ComplexityWorkload;
}): string => {
  const structural = input.profile.structural;
  const dataStatus = input.profile.dataEstimate?.status ?? 'not-estimated';
  const workloadText = `workload ${describeRows(input.workload.rows)} (${input.workload.status})`;
  const scoreText = input.score === null ? 'no policy score' : `${input.score}/100 policy`;
  return `${input.level} (${scoreText}): ${workloadText}, data ${dataStatus}, structural ${input.structural}/100, ${structural.computedFieldCount} computed field(s), depth ${structural.maxDependencyDepth ?? structural.depthStatus}.`;
};

/**
 * Convert a schema/data profile into a deterministic, explainable conclusion.
 * The level comes from workload bounds; the score is a nullable policy index
 * for ordering only, not latency or physical database cost.
 */
export function buildComplexityAssessment(profile: SchemaComplexityProfile): ComplexityAssessment {
  const structural = structuralScore(profile);
  const dataWork = dataWorkComponent(profile);
  const workload = buildWorkload(profile);
  const risks = collectRisks(profile, dataWork);
  const risk = clampScore(
    risks.reduce((sum, signal) => sum + RISK_SEVERITY_WEIGHT[signal.severity], 0)
  );

  const weightedScore =
    dataWork.score === null
      ? null
      : clampScore(
          (structural * WEIGHTS.structural +
            risk * WEIGHTS.risk +
            dataWork.score * WEIGHTS.dataWork) /
            (WEIGHTS.structural + WEIGHTS.dataWork + WEIGHTS.risk)
        );

  return {
    policyVersion: COMPLEXITY_POLICY_VERSION,
    level: workload.level,
    score: weightedScore,
    headline: headlineFor({
      profile,
      level: workload.level,
      score: weightedScore,
      structural,
      workload,
    }),
    workload,
    breakdown: buildWorkloadBreakdown(profile),
    components: {
      structural,
      dataWork: dataWork.score,
      risk,
    },
    reasonCodes: risks.map((item) => item.code),
    recommendations: recommendationsFor({ risks, structural, workload, dataWork: dataWork.score }),
    confidence: assessmentConfidence(profile, dataWork),
  };
}
