/* eslint-disable sonarjs/cognitive-complexity -- explicit range math keeps unknown/bounded semantics auditable */
import type {
  OperationPropagationPath,
  PathBeforeImage,
  PropagationCertainty,
  SchemaOperationShapeProfile,
} from './ComplexityProfile';

/**
 * Data-aware estimates are additive to the schema-only profile. A missing
 * statistic is represented by `status: 'unknown'`, never by zero.
 */
export type DataStatisticsSource = 'pg_catalog' | 'pg_stats' | 'sample' | 'caller' | 'unknown';
export type DataStatisticsConfidence = 'high' | 'medium' | 'low';
export type DataStatisticsCompleteness = 'complete' | 'partial' | 'unknown';
export type LinkFanoutMethod = 'catalog' | 'sample' | 'caller' | 'unknown';
export type RangeStatus = 'estimated' | 'bounded' | 'unknown';

export type FieldDataStatistics = {
  readonly fieldId: string;
  readonly nDistinct: number | null;
  readonly nullFraction: number | null;
  readonly avgWidth: number | null;
  /** Average input rows for lookup/rollup aggregation; null when unknown. */
  readonly avgInputRows?: number | null;
};

export type LinkFanoutStatistics = {
  readonly fromTableId: string;
  readonly toTableId: string;
  /** Exact link identity. Null means the relation is not link-based. */
  readonly linkFieldId: string | null;
  readonly mean: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly max: number | null;
  readonly method: LinkFanoutMethod;
  readonly source: DataStatisticsSource;
  readonly completeness: DataStatisticsCompleteness;
  readonly confidence: DataStatisticsConfidence;
  readonly warnings?: ReadonlyArray<string>;
};

/**
 * A conditional propagation hit statistic. `fraction` is only valid for the
 * exact dirty-source batch described by `sourceDirtyCount` and
 * `includesBeforeImage`; it is not a generic per-source-row selectivity.
 */
export type ConditionalTargetHitStatistics = {
  readonly fromTableId: string;
  readonly toTableId: string;
  readonly fromFieldId: string;
  readonly toFieldId: string;
  readonly linkFieldId: string | null;
  readonly fraction: number | null;
  readonly sourceDirtyCount: number | null;
  readonly includesBeforeImage: boolean;
  readonly source: DataStatisticsSource;
  readonly completeness: DataStatisticsCompleteness;
  readonly confidence: DataStatisticsConfidence;
  readonly warnings?: ReadonlyArray<string>;
};

export type TableDataStatistics = {
  readonly tableId: string;
  readonly rowCount: number | null;
  readonly avgRowBytes: number | null;
  readonly lastAnalyzeAt: string | null;
  readonly fields: ReadonlyArray<FieldDataStatistics>;
  readonly links: ReadonlyArray<LinkFanoutStatistics>;
  readonly conditionals?: ReadonlyArray<ConditionalTargetHitStatistics>;
};

export type DataStatisticsSnapshot = TableDataStatistics & {
  readonly relatedTables?: ReadonlyArray<TableDataStatistics>;
  readonly capturedAt: string;
  readonly source: DataStatisticsSource;
  readonly completeness: DataStatisticsCompleteness;
  readonly confidence: DataStatisticsConfidence;
  readonly warnings?: ReadonlyArray<string>;
  /** Fraction of dirty rows that actually change; null means unknown. */
  readonly changeRate?: number | null;
};

export type EstimatedRange = {
  readonly status: RangeStatus;
  readonly expected: number | null;
  readonly lower: number | null;
  readonly upper: number | null;
};

export type DataEstimateMetricTotals = {
  readonly scan: EstimatedRange;
  readonly dirty: EstimatedRange;
  readonly aggregateInput: EstimatedRange;
  readonly estimatedWrites: EstimatedRange;
};

export type DataEstimateTotals = {
  /** Sum across independent paths; mutually exclusive groups use an envelope. */
  readonly pathWork: DataEstimateMetricTotals;
  /** Distinct rows by source/target field/table; same field is not summed twice. */
  readonly distinct: DataEstimateMetricTotals;
};

export type PathDataEstimate = {
  readonly fromTableId: string;
  readonly toTableId: string;
  readonly fromFieldId: string;
  readonly toFieldId: string;
  readonly mode: OperationPropagationPath['mode'];
  readonly origin: OperationPropagationPath['origin'];
  readonly certainty: PropagationCertainty;
  readonly linkFieldId: string | null;
  readonly beforeImage: PathBeforeImage;
  readonly alternativeGroup: string | null;
  readonly level: number;
  /** Table actually scanned for scan work; target table for conditional/allTarget/backfill. */
  readonly scanTableId: string;
  readonly scan: EstimatedRange;
  readonly dirty: EstimatedRange;
  readonly aggregateInput: EstimatedRange;
  /** Estimated changed writes; unknown without changeRate. Not actual writes. */
  readonly estimatedWrites: EstimatedRange;
  readonly warnings: ReadonlyArray<string>;
};

export type DataEstimate = {
  readonly status: 'estimated' | 'partial' | 'not-estimated';
  readonly seedRecordCount: number | null;
  readonly paths: ReadonlyArray<PathDataEstimate>;
  readonly totals: DataEstimateTotals;
  readonly confidence: DataStatisticsConfidence;
  readonly assumptions: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
};

const UNKNOWN_RANGE: EstimatedRange = {
  status: 'unknown',
  expected: null,
  lower: null,
  upper: null,
};

const exactRange = (value: number | null): EstimatedRange =>
  value === null
    ? UNKNOWN_RANGE
    : { status: 'estimated', expected: value, lower: value, upper: value };

const normalizeRange = (
  value: {
    readonly expected: number | null;
    readonly lower: number | null;
    readonly upper: number | null;
  },
  warnings: string[],
  warningCode: string
): EstimatedRange => {
  const { expected, lower, upper } = value;
  if (expected !== null && ((lower !== null && lower > expected) || (upper !== null && expected > upper))) {
    warnings.push(`${warningCode}:range-order`);
    return UNKNOWN_RANGE;
  }
  if (expected === null && lower !== null && upper !== null && lower > upper) {
    warnings.push(`${warningCode}:range-order`);
    return UNKNOWN_RANGE;
  }
  if (
    expected === null &&
    lower !== null &&
    upper !== null &&
    lower === upper
  ) {
    return { status: 'estimated', expected: lower, lower, upper };
  }
  if (expected !== null) return { status: 'estimated', expected, lower, upper };
  if (lower !== null || upper !== null) return { status: 'bounded', expected: null, lower, upper };
  return UNKNOWN_RANGE;
};

const scaleRange = (
  range: EstimatedRange,
  factor: number | null,
  warnings: string[],
  warningCode: string
): EstimatedRange => {
  if (factor === null) return UNKNOWN_RANGE;
  return normalizeRange(
    {
      expected: range.expected === null ? null : range.expected * factor,
      lower: range.lower === null ? null : range.lower * factor,
      upper: range.upper === null ? null : range.upper * factor,
    },
    warnings,
    warningCode
  );
};

const capRange = (range: EstimatedRange, cap: number | null): EstimatedRange => {
  if (cap === null) return range;
  return normalizeRange(
    {
      expected: range.expected === null ? null : Math.min(range.expected, cap),
      lower: range.lower === null ? null : Math.min(range.lower, cap),
      upper: range.upper === null ? null : Math.min(range.upper, cap),
    },
    [],
    'cap'
  );
};

/**
 * Add independent ranges. Known bounds survive an unknown peer: a lower bound
 * still bounds the sum from below, while an unknown upper bound makes the
 * total upper bound unknown.
 */
const sumRanges = (ranges: ReadonlyArray<EstimatedRange>): EstimatedRange => {
  if (ranges.length === 0) return UNKNOWN_RANGE;
  const expectedValues = ranges.map((range) => range.expected);
  const lowerValues = ranges.map((range) => range.lower).filter((value): value is number => value !== null);
  const upperValues = ranges.map((range) => range.upper);
  const expected = expectedValues.some((value) => value === null)
    ? null
    : expectedValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const lower = lowerValues.length === 0 ? null : lowerValues.reduce((sum, value) => sum + value, 0);
  const upper = upperValues.some((value) => value === null)
    ? null
    : upperValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return normalizeRange({ expected, lower, upper }, [], 'sum');
};

const maxRanges = (ranges: ReadonlyArray<EstimatedRange>): EstimatedRange => {
  if (ranges.length === 0) return UNKNOWN_RANGE;
  const expected = ranges.some((range) => range.expected === null)
    ? null
    : Math.max(...ranges.map((range) => range.expected as number));
  const lowerValues = ranges.map((range) => range.lower).filter((value): value is number => value !== null);
  const upper = ranges.some((range) => range.upper === null)
    ? null
    : Math.max(...ranges.map((range) => range.upper as number));
  return normalizeRange(
    { expected, lower: lowerValues.length ? Math.max(...lowerValues) : null, upper },
    [],
    'max'
  );
};

const unionRanges = (ranges: ReadonlyArray<EstimatedRange>, cap: number | null): EstimatedRange => {
  if (ranges.length === 0) return UNKNOWN_RANGE;
  if (ranges.length === 1) return capRange(ranges[0]!, cap);
  const expected = ranges.some((range) => range.expected === null)
    ? null
    : Math.min(
        cap ?? Number.POSITIVE_INFINITY,
        ranges.reduce((sum, range) => sum + (range.expected ?? 0), 0)
      );
  const lowerValues = ranges
    .map((range) => range.lower)
    .filter((value): value is number => value !== null);
  const upper = ranges.some((range) => range.upper === null)
    ? null
    : Math.min(
        cap ?? Number.POSITIVE_INFINITY,
        ranges.reduce((sum, range) => sum + (range.upper ?? 0), 0)
      );
  return capRange(
    normalizeRange(
      {
        expected: ranges.length > 1 ? null : expected,
        lower: lowerValues.length ? Math.max(...lowerValues) : null,
        upper,
      },
      [],
      'union'
    ),
    cap
  );
};

const envelopeRanges = (ranges: ReadonlyArray<EstimatedRange>): EstimatedRange => {
  if (ranges.length === 0) return UNKNOWN_RANGE;
  if (ranges.length === 1) return ranges[0]!;
  const expectedValues = ranges.map((range) => range.expected);
  const sameExpected = expectedValues.every(
    (value) => value !== null && value === expectedValues[0]
  );
  const lowerValues = ranges
    .map((range) => range.lower)
    .filter((value): value is number => value !== null);
  const upperValues = ranges
    .map((range) => range.upper)
    .filter((value): value is number => value !== null);
  return normalizeRange(
    {
      expected: sameExpected ? expectedValues[0]! : null,
      lower: lowerValues.length ? Math.min(...lowerValues) : null,
      upper: upperValues.length === ranges.length ? Math.max(...upperValues) : null,
    },
    [],
    'alternative'
  );
};

const findTable = (
  statistics: DataStatisticsSnapshot,
  tableId: string
): TableDataStatistics | null => {
  if (statistics.tableId === tableId) return statistics;
  return statistics.relatedTables?.find((table) => table.tableId === tableId) ?? null;
};

const findLink = (
  statistics: DataStatisticsSnapshot,
  path: OperationPropagationPath
): LinkFanoutStatistics | null => {
  if (path.linkFieldId === null) return null;
  const tables = [statistics, ...(statistics.relatedTables ?? [])];
  for (const table of tables) {
    const match = table.links.find(
      (link) =>
        link.fromTableId === path.fromTableId &&
        link.toTableId === path.toTableId &&
        link.linkFieldId === path.linkFieldId
    );
    if (match) return match;
  }
  return null;
};

const findConditional = (
  statistics: DataStatisticsSnapshot,
  path: OperationPropagationPath
): ConditionalTargetHitStatistics | null => {
  const tables = [statistics, ...(statistics.relatedTables ?? [])];
  for (const table of tables) {
    const match = table.conditionals?.find(
      (entry) =>
        entry.fromTableId === path.fromTableId &&
        entry.toTableId === path.toTableId &&
        entry.fromFieldId === path.fromFieldId &&
        entry.toFieldId === path.toFieldId &&
        entry.linkFieldId === path.linkFieldId &&
        entry.includesBeforeImage === (path.beforeImage === 'included')
    );
    if (match) return match;
  }
  return null;
};

const findField = (
  statistics: DataStatisticsSnapshot,
  fieldId: string
): FieldDataStatistics | null => {
  const tables = [statistics, ...(statistics.relatedTables ?? [])];
  for (const table of tables) {
    const match = table.fields.find((field) => field.fieldId === fieldId);
    if (match) return match;
  }
  return null;
};

const multiplySourceByFanout = (
  source: EstimatedRange,
  fanout: LinkFanoutStatistics | null,
  targetRows: number | null,
  warnings: string[]
): EstimatedRange => {
  if (fanout === null) {
    warnings.push('missing-link-fanout');
    return UNKNOWN_RANGE;
  }
  if (fanout.mean === null) warnings.push('missing-link-mean');
  if (fanout.p50 === null) warnings.push('missing-link-p50');
  if (fanout.p95 === null) warnings.push('missing-link-p95');
  return capRange(
    normalizeRange(
      {
        expected:
          source.expected === null || fanout.mean === null
            ? null
            : source.expected * fanout.mean,
        lower:
          source.lower === null || fanout.p50 === null ? null : source.lower * fanout.p50,
        upper:
          source.upper === null || fanout.p95 === null ? null : source.upper * fanout.p95,
      },
      warnings,
      'link-fanout'
    ),
    targetRows
  );
};

const estimatePath = (input: {
  readonly path: OperationPropagationPath;
  readonly statistics: DataStatisticsSnapshot;
  readonly sourceDirty: EstimatedRange;
}): PathDataEstimate => {
  const { path, statistics, sourceDirty } = input;
  const targetTableId = path.origin === 'field-backfill' ? path.fromTableId : path.toTableId;
  const scanTableId =
    path.mode === 'sameRecord' || path.mode === 'linkTraversal' ? path.fromTableId : targetTableId;
  const targetRows = findTable(statistics, targetTableId)?.rowCount ?? null;
  const warnings: string[] = [];
  let scan: EstimatedRange = UNKNOWN_RANGE;
  let dirty: EstimatedRange = UNKNOWN_RANGE;

  if (path.mode === 'sameRecord') {
    scan = sourceDirty;
    dirty = capRange(sourceDirty, targetRows);
  } else if (path.mode === 'linkTraversal') {
    scan = sourceDirty;
    if (path.linkFieldId === null) {
      warnings.push('missing-link-field');
    }
    dirty = multiplySourceByFanout(
      sourceDirty,
      findLink(statistics, path),
      targetRows,
      warnings
    );
  } else if (path.mode === 'conditionalFiltered') {
    scan = exactRange(targetRows);
    const conditional = findConditional(statistics, path);
    const fraction = conditional?.fraction ?? null;
    const sourceCount = sourceDirty.expected;
    const batchMatches =
      sourceCount !== null &&
      conditional?.sourceDirtyCount !== null &&
      conditional?.sourceDirtyCount !== undefined &&
      conditional.sourceDirtyCount === sourceCount;
    if (fraction === null || targetRows === null || !batchMatches || path.beforeImage === 'unknown') {
      dirty = normalizeRange({ expected: null, lower: 0, upper: targetRows }, warnings, 'conditional');
      if (fraction === null) warnings.push('missing-conditional-target-hit-fraction');
      if (fraction !== null && !batchMatches) warnings.push('conditional-batch-mismatch');
      if (path.beforeImage === 'unknown') warnings.push('conditional-before-image-unknown');
    } else {
      dirty = exactRange(targetRows * fraction);
    }
  } else if (path.mode === 'allTargetRecords' || path.mode === 'backfill') {
    scan = exactRange(targetRows);
    dirty = exactRange(targetRows);
  }

  const field = findField(statistics, path.toFieldId);
  const aggregateInput = scaleRange(
    dirty,
    field?.avgInputRows ?? null,
    warnings,
    'aggregate-input'
  );
  if (aggregateInput.status === 'unknown') warnings.push('missing-avg-input-rows');

  const estimatedWrites = scaleRange(
    dirty,
    statistics.changeRate ?? null,
    warnings,
    'estimated-writes'
  );
  if (estimatedWrites.status === 'unknown') warnings.push('missing-change-rate');
  if (targetRows === null) warnings.push(`missing-target-row-count:${targetTableId}`);
  if (sourceDirty.status !== 'estimated' && path.mode !== 'allTargetRecords' && path.mode !== 'backfill') {
    warnings.push('source-dirty-not-exact');
  }
  if (path.certainty === 'unknown') warnings.push('path-certainty-unknown');

  return {
    fromTableId: path.fromTableId,
    toTableId: path.toTableId,
    fromFieldId: path.fromFieldId,
    toFieldId: path.toFieldId,
    mode: path.mode,
    origin: path.origin,
    certainty: path.certainty,
    linkFieldId: path.linkFieldId,
    beforeImage: path.beforeImage,
    alternativeGroup: path.alternativeGroup,
    level: path.level,
    scanTableId,
    scan,
    dirty,
    aggregateInput,
    estimatedWrites,
    warnings: [...new Set(warnings)].sort(),
  };
};

const distinctScan = (
  paths: ReadonlyArray<PathDataEstimate>,
  statistics: DataStatisticsSnapshot
): EstimatedRange => {
  const bySource = new Map<string, PathDataEstimate[]>();
  for (const path of paths) {
    const group = bySource.get(path.scanTableId);
    if (group) group.push(path);
    else bySource.set(path.scanTableId, [path]);
  }
  const ranges = [...bySource.entries()].map(([tableId, group]) => {
    const rows = findTable(statistics, tableId)?.rowCount ?? null;
    return capRange(maxRanges(group.map((path) => path.scan)), rows);
  });
  return sumRanges(ranges);
};

const distinctByTargetField = (
  paths: ReadonlyArray<PathDataEstimate>,
  statistics: DataStatisticsSnapshot,
  selector: (path: PathDataEstimate) => EstimatedRange
): EstimatedRange => {
  const byField = new Map<string, PathDataEstimate[]>();
  for (const path of paths) {
    const key = `${path.toTableId}\u0000${path.toFieldId}`;
    const group = byField.get(key);
    if (group) group.push(path);
    else byField.set(key, [path]);
  }
  const fieldRanges = [...byField.values()].map((group) => {
    const targetRows = findTable(statistics, group[0]!.toTableId)?.rowCount ?? null;
    return {
      toTableId: group[0]!.toTableId,
      range: capRange(maxRanges(group.map(selector)), targetRows),
    };
  });
  const byTable = new Map<string, typeof fieldRanges>();
  for (const range of fieldRanges) {
    const group = byTable.get(range.toTableId);
    if (group) group.push(range);
    else byTable.set(range.toTableId, [range]);
  }
  const tableRanges = [...byTable.entries()].map(([tableId, group]) => {
    const rows = findTable(statistics, tableId)?.rowCount ?? null;
    return capRange(sumRanges(group.map((entry) => entry.range)), rows);
  });
  return sumRanges(tableRanges);
};

const combinePathWorkTotals = (
  paths: ReadonlyArray<PathDataEstimate>
): DataEstimateMetricTotals => {
  const combine = (selector: (path: PathDataEstimate) => EstimatedRange): EstimatedRange => {
    const grouped = new Map<string, EstimatedRange[]>();
    const add: EstimatedRange[] = [];
    for (const path of paths) {
      if (path.alternativeGroup === null) add.push(selector(path));
      else {
        const group = grouped.get(path.alternativeGroup);
        if (group) group.push(selector(path));
        else grouped.set(path.alternativeGroup, [selector(path)]);
      }
    }
    for (const group of grouped.values()) add.push(envelopeRanges(group));
    return sumRanges(add);
  };

  return {
    scan: combine((path) => path.scan),
    dirty: combine((path) => path.dirty),
    aggregateInput: combine((path) => path.aggregateInput),
    estimatedWrites: combine((path) => path.estimatedWrites),
  };
};

const combineDistinctTotals = (
  paths: ReadonlyArray<PathDataEstimate>,
  statistics: DataStatisticsSnapshot
): DataEstimateMetricTotals => ({
  scan: distinctScan(paths, statistics),
  dirty: distinctByTargetField(paths, statistics, (path) => path.dirty),
  aggregateInput: distinctByTargetField(paths, statistics, (path) => path.aggregateInput),
  estimatedWrites: distinctByTargetField(paths, statistics, (path) => path.estimatedWrites),
});

const pathWarnings = (paths: ReadonlyArray<PathDataEstimate>): string[] => [
  ...new Set(paths.flatMap((path) => path.warnings)),
];

const isPartial = (paths: ReadonlyArray<PathDataEstimate>): boolean =>
  paths.length === 0 ||
  paths.some(
    (path) =>
      path.scan.status !== 'estimated' ||
      path.dirty.status !== 'estimated' ||
      path.aggregateInput.status !== 'estimated' ||
      path.estimatedWrites.status !== 'estimated'
  );

export function estimateOperationData(input: {
  readonly operation: SchemaOperationShapeProfile | null;
  readonly statistics?: DataStatisticsSnapshot | null;
  readonly seedRecordCount?: number | null;
}): DataEstimate {
  const seedRecordCount =
    input.seedRecordCount === undefined || input.seedRecordCount === null
      ? null
      : input.seedRecordCount;
  const warnings: string[] = [];
  const assumptions = [
    'propagation is evaluated in Kahn/topological level order',
    'missing statistics stay unknown; bounded ranges preserve known bounds',
    'mutually exclusive alternative paths are combined as an envelope, not summed',
    'estimated writes are not actual writes',
  ];

  const operation = input.operation;
  const statistics = input.statistics ?? null;
  const plannerPaths =
    operation?.effectiveShapeSource === 'planner'
      ? (operation.plannerShape?.propagationPaths ?? [])
      : [];
  const schemaPaths = operation?.schemaPotential.propagationPaths ?? [];
  const effectivePaths =
    operation?.effectiveShapeSource === 'planner' && plannerPaths.length === 0
      ? schemaPaths
      : operation?.effectiveShapeSource === 'planner'
        ? plannerPaths
        : schemaPaths;
  if (
    operation?.effectiveShapeSource === 'planner' &&
    plannerPaths.length === 0 &&
    schemaPaths.length > 0
  ) {
    warnings.push('planner-paths-empty-using-schema-potential');
  }

  if (statistics === null) warnings.push('statistics-missing');
  if (operation === null) warnings.push('operation-missing');
  if (seedRecordCount === null) warnings.push('seed-record-count-missing');
  if (
    statistics !== null &&
    seedRecordCount !== null &&
    operation !== null &&
    operation.uncertainty === 'known' &&
    effectivePaths.length === 0
  ) {
    const zero = exactRange(0);
    return {
      status: 'estimated',
      seedRecordCount,
      paths: [],
      totals: {
        pathWork: { scan: zero, dirty: zero, aggregateInput: zero, estimatedWrites: zero },
        distinct: { scan: zero, dirty: zero, aggregateInput: zero, estimatedWrites: zero },
      },
      confidence: statistics.confidence,
      assumptions,
      warnings,
    };
  }
  if (!statistics || seedRecordCount === null || operation === null || effectivePaths.length === 0) {
    return {
      status: 'not-estimated',
      seedRecordCount,
      paths: [],
      totals: {
        pathWork: {
          scan: UNKNOWN_RANGE,
          dirty: UNKNOWN_RANGE,
          aggregateInput: UNKNOWN_RANGE,
          estimatedWrites: UNKNOWN_RANGE,
        },
        distinct: {
          scan: UNKNOWN_RANGE,
          dirty: UNKNOWN_RANGE,
          aggregateInput: UNKNOWN_RANGE,
          estimatedWrites: UNKNOWN_RANGE,
        },
      },
      confidence: statistics?.confidence ?? 'low',
      assumptions,
      warnings,
    };
  }

  const dirtyByField = new Map<string, EstimatedRange>();
  for (const fieldId of operation.changedFieldIds) dirtyByField.set(fieldId, exactRange(seedRecordCount));
  const sortedPaths = [...effectivePaths].sort((left, right) => left.level - right.level);
  const paths: PathDataEstimate[] = [];

  for (const path of sortedPaths) {
    const sourceDirty =
      path.origin === 'field-backfill'
        ? exactRange(seedRecordCount)
        : (dirtyByField.get(path.fromFieldId) ?? UNKNOWN_RANGE);
    const estimate = estimatePath({ path, statistics, sourceDirty });
    paths.push(estimate);
    if (path.origin !== 'field-backfill') {
      const existing = dirtyByField.get(path.toFieldId);
      const union =
        existing === undefined
          ? estimate.dirty
          : unionRanges(
              [existing, estimate.dirty],
              findTable(statistics, path.toTableId)?.rowCount ?? null
            );
      dirtyByField.set(path.toFieldId, union);
    }
  }

  const allWarnings = [...new Set([...warnings, ...pathWarnings(paths), ...(statistics.warnings ?? [])])];
  const status = isPartial(paths) ? 'partial' : 'estimated';

  return {
    status,
    seedRecordCount,
    paths,
    totals: {
      pathWork: combinePathWorkTotals(paths),
      distinct: combineDistinctTotals(paths, statistics),
    },
    confidence: statistics.confidence,
    assumptions,
    warnings: allWarnings,
  };
}
