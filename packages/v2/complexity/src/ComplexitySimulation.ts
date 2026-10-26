/* eslint-disable sonarjs/cognitive-complexity -- assumption mapping keeps null semantics explicit across tables/links/fields */
import {
  buildSchemaComplexityProfile,
  type OperationDescriptor,
  type SchemaComplexityEdge,
  type SchemaComplexityField,
  type SchemaComplexityProfile,
} from './ComplexityProfile';
import {
  estimateOperationData,
  type ConditionalTargetHitStatistics,
  type DataEstimate,
  type DataStatisticsSnapshot,
  type LinkFanoutStatistics,
  type TableDataStatistics,
} from './ComplexityDataEstimate';

/**
 * Hypothetical inputs for a schema-only simulation. None of these are read from
 * PostgreSQL or records; every value is an explicit caller assumption.
 */
export type SchemaComplexityAssumptions = {
  readonly rowCounts?: Readonly<Record<string, number>>;
  readonly seedRecordCount?: number;
  readonly linkFanout?: Readonly<
    Record<
      string,
      {
        readonly mean?: number;
        readonly p50?: number;
        readonly p95?: number;
        readonly max?: number;
      }
    >
  >;
  /**
   * Conditional hit fraction keyed by target field id. Each fraction is only
   * valid for the exact dirty-source batch it was recorded on.
   */
  readonly conditionalTargetHitFractions?: Readonly<
    Record<
      string,
      {
        readonly fraction: number;
        readonly sourceDirtyCount: number;
        readonly includesBeforeImage: boolean;
      }
    >
  >;
  readonly avgInputRows?: Readonly<Record<string, number>>;
  readonly changeRate?: number;
  readonly capturedAt?: string;
};

export type SimulatedSchemaComplexityProfile = SchemaComplexityProfile & {
  readonly dataEstimate: DataEstimate;
};

const DEFAULT_CAPTURED_AT = '1970-01-01T00:00:00.000Z';


const finiteNonNegative = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;

const finiteUnitFraction = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;

const optionalNonNegative = (
  value: number | undefined,
  warning: string,
  warnings: string[]
): number | null => {
  if (value === undefined) return null;
  if (finiteNonNegative(value) === undefined) {
    warnings.push(warning);
    return null;
  }
  return value;
};
const collectTableIds = (
  fields: ReadonlyArray<SchemaComplexityField>,
  edges: ReadonlyArray<SchemaComplexityEdge>,
  operation: OperationDescriptor
): ReadonlyArray<string> =>
  [
    ...new Set([
      operation.tableId,
      ...fields.map((field) => field.tableId),
      ...edges.flatMap((edge) => [edge.fromTableId, edge.toTableId]),
    ]),
  ].sort();

/**
 * Lower-level pure mapping from schema + caller assumptions to the statistics
 * snapshot. Primary consumers should use `simulateSchemaComplexity`; this is
 * exported for tests and for hosts that need the snapshot before estimating.
 */
export const buildSchemaComplexityStatistics = (
  fields: ReadonlyArray<SchemaComplexityField>,
  edges: ReadonlyArray<SchemaComplexityEdge>,
  operation: OperationDescriptor,
  assumptions: SchemaComplexityAssumptions
): { statistics: DataStatisticsSnapshot | null; warnings: string[] } => {
  const hasAssumptions =
    assumptions.rowCounts !== undefined ||
    assumptions.seedRecordCount !== undefined ||
    assumptions.linkFanout !== undefined ||
    assumptions.conditionalTargetHitFractions !== undefined ||
    assumptions.avgInputRows !== undefined ||
    assumptions.changeRate !== undefined;
  if (!hasAssumptions) return { statistics: null, warnings: [] };

  const tableIds = collectTableIds(fields, edges, operation);
  const rowCounts = assumptions.rowCounts ?? {};
  const warnings: string[] = [];
  const fieldsByTable = new Map<string, SchemaComplexityField[]>();
  for (const field of fields) {
    const group = fieldsByTable.get(field.tableId);
    if (group) group.push(field);
    else fieldsByTable.set(field.tableId, [field]);
  }

  const tables: TableDataStatistics[] = tableIds.map((tableId) => ({
    tableId,
    rowCount: rowCounts[tableId] ?? null,
    avgRowBytes: null,
    lastAnalyzeAt: null,
    fields: (fieldsByTable.get(tableId) ?? []).map((field) => ({
      fieldId: field.id,
      nDistinct: null,
      nullFraction: null,
      avgWidth: null,
      avgInputRows: assumptions.avgInputRows?.[field.id] ?? null,
    })),
    links: [],
  }));

  const linksBySource = new Map<string, LinkFanoutStatistics[]>();
  const linkKeys = Object.keys(assumptions.linkFanout ?? {});
  for (const linkFieldId of [...linkKeys].sort()) {
    const edge = edges.find((candidate) => candidate.linkFieldId === linkFieldId);
    if (!edge) {
      warnings.push(`unknown-link-field:${linkFieldId}`);
      continue;
    }
    const fanout = assumptions.linkFanout?.[linkFieldId];
    const fanoutProvided =
      fanout !== undefined &&
      (fanout.mean !== undefined ||
        fanout.p50 !== undefined ||
        fanout.p95 !== undefined ||
        fanout.max !== undefined);
    const fanoutComplete =
      fanoutProvided &&
      fanout.mean !== undefined &&
      fanout.p50 !== undefined &&
      fanout.p95 !== undefined &&
      fanout.max !== undefined;
    const linkWarnings = !fanoutProvided
      ? ['fanout-assumption-missing']
      : fanoutComplete
        ? undefined
        : ['fanout-percentiles-missing'];
    const link: LinkFanoutStatistics = {
      fromTableId: edge.fromTableId,
      toTableId: edge.toTableId,
      linkFieldId,
      mean: fanout?.mean ?? null,
      p50: fanout?.p50 ?? null,
      p95: fanout?.p95 ?? null,
      max: fanout?.max ?? null,
      method: fanoutProvided ? 'caller' : 'unknown',
      source: 'caller',
      completeness: !fanoutProvided ? 'unknown' : fanoutComplete ? 'complete' : 'partial',
      confidence: fanoutComplete ? 'medium' : 'low',
      ...(linkWarnings ? { warnings: linkWarnings } : {}),
    };
    if (!tables.some((table) => table.tableId === edge.fromTableId)) {
      warnings.push(`unknown-source-table:${edge.fromTableId}`);
      continue;
    }
    const list = linksBySource.get(edge.fromTableId) ?? [];
    list.push(link);
    linksBySource.set(edge.fromTableId, list);
  }
  const conditionalsByTable = new Map<string, ConditionalTargetHitStatistics[]>();
  for (const [targetFieldId, assumption] of Object.entries(
    assumptions.conditionalTargetHitFractions ?? {}
  ).sort(([left], [right]) => left.localeCompare(right))) {
    const edge = edges.find((candidate) => candidate.toFieldId === targetFieldId);
    if (!edge) {
      warnings.push(`unknown-conditional-target-field:${targetFieldId}`);
      continue;
    }
    const fraction = finiteUnitFraction(assumption.fraction);
    const sourceDirtyCount = finiteNonNegative(assumption.sourceDirtyCount);
    if (fraction === undefined || sourceDirtyCount === undefined) {
      warnings.push(`invalid-conditional-hit:${targetFieldId}`);
      continue;
    }
    const conditionals = conditionalsByTable.get(edge.toTableId) ?? [];
    conditionals.push({
      fromTableId: edge.fromTableId,
      toTableId: edge.toTableId,
      fromFieldId: edge.fromFieldId,
      toFieldId: edge.toFieldId,
      linkFieldId: edge.linkFieldId ?? null,
      fraction,
      sourceDirtyCount,
      includesBeforeImage: assumption.includesBeforeImage,
      source: 'caller',
      completeness: 'complete',
      confidence: 'medium',
    });
    conditionalsByTable.set(edge.toTableId, conditionals);
  }

  const tablesWithLinks = tables.map((table) => ({
    ...table,
    links: linksBySource.get(table.tableId) ?? [],
    conditionals: conditionalsByTable.get(table.tableId) ?? [],
  }));
  const primary =
    tablesWithLinks.find((table) => table.tableId === operation.tableId) ?? tablesWithLinks[0];
  if (!primary) return { statistics: null, warnings };
  const relatedTables = tablesWithLinks.filter((table) => table.tableId !== primary.tableId);
  const allRowsKnown = tablesWithLinks.every((table) => table.rowCount !== null);
  return {
    statistics: {
      ...primary,
      relatedTables,
      capturedAt: assumptions.capturedAt ?? DEFAULT_CAPTURED_AT,
      source: 'caller',
      completeness: allRowsKnown ? 'complete' : 'partial',
      confidence: allRowsKnown ? 'medium' : 'low',
      warnings,
      changeRate: assumptions.changeRate ?? null,
    },
    warnings,
  };
};

/**
 * Build a complexity profile from schema + hypothetical assumptions only.
 * No Table, record, database, or PG statistics access is involved.
 */
export function simulateSchemaComplexity(input: {
  readonly schema: {
    readonly fields: ReadonlyArray<SchemaComplexityField>;
    readonly edges: ReadonlyArray<SchemaComplexityEdge>;
  };
  readonly operation: OperationDescriptor;
  readonly assumptions?: SchemaComplexityAssumptions;
  readonly completeness?: 'complete' | 'partial' | 'truncated';
  readonly focusTableId?: string;
  readonly maxTraversalDepth?: number;
}): SimulatedSchemaComplexityProfile {
  const assumptions = input.assumptions ?? {};
  const built = buildSchemaComplexityProfile({
    fields: input.schema.fields,
    edges: input.schema.edges,
    operation: input.operation,
    completeness: input.completeness ?? 'partial',
    ...(input.focusTableId ? { focusTableId: input.focusTableId } : {}),
    ...(input.maxTraversalDepth === undefined
      ? {}
      : { maxTraversalDepth: input.maxTraversalDepth }),
  });
  const { statistics } = buildSchemaComplexityStatistics(
    input.schema.fields,
    input.schema.edges,
    input.operation,
    assumptions
  );

  return {
    ...built,
    dataEstimate: estimateOperationData({
      operation: built.operation,
      statistics,
      seedRecordCount: assumptions.seedRecordCount ?? null,
    }),
  };
}
