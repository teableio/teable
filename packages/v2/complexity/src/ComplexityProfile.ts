/* eslint-disable sonarjs/cognitive-complexity -- iterative graph traversal and bounded propagation inference keep their state machines in single-pass loops */
import type { DataEstimate } from './ComplexityDataEstimate';
import type { FormulaProfile } from './FormulaProfile';

/**
 * Pure, schema-only complexity profile.
 *
 * This module intentionally has no SQL, PostgreSQL, planner, or runtime
 * dependencies. It describes the structural shape that a command *may* touch
 * from the supplied field dependency graph. It never estimates row counts,
 * write counts, fan-out, or timings.
 *
 * Determinism: every array and record is normalized (deduplicated where it is
 * a set, sorted where order is not meaningful). Given the same schema inputs
 * and operation descriptor, the output is byte-for-byte stable under JSON
 * serialization.
 */

export const SCHEMA_COMPLEXITY_PROFILE_VERSION = 1 as const;
export const SCHEMA_COMPLEXITY_BASIS = 'schema-only' as const;

export type SchemaCompleteness = 'complete' | 'partial' | 'truncated';
export type SchemaBeforeImage = 'available' | 'unavailable' | 'unknown';
export type SchemaDataPresence = 'unknown' | 'empty';
export type SchemaOperationKind = 'update' | 'create' | 'delete' | 'paste' | 'field-change';
export type SchemaFieldChange = 'create' | 'update' | 'delete' | 'convert';
export type SchemaPasteMode = 'insert' | 'update' | 'mixed';
export type SchemaEdgeKind = 'same_record' | 'cross_record';

export type PropagationMode =
  | 'sameRecord'
  | 'linkTraversal'
  | 'conditionalFiltered'
  | 'allTargetRecords'
  | 'backfill';
export type PropagationCertainty = 'structural' | 'possible' | 'unknown';
export type PathBeforeImage = 'included' | 'not-required' | 'unknown';

export type PropagationModeCounts = Readonly<Record<PropagationMode, number>>;

export type OperationRiskFlag =
  | 'conditional-all-target-possible'
  | 'conditional-before-image-unknown'
  | 'conditional-target-backfill'
  | 'dependency-cycle'
  | 'empty-changed-fields'
  | 'field-change-without-field-change'
  | 'field-delete-no-backfill'
  | 'field-delete-work-unknown'
  | 'field-convert-work-unknown'
  | 'invalid-max-traversal-depth'
  | 'missing-condition-metadata'
  | 'missing-link-metadata'
  | 'planner-before-image-missing'
  | 'planner-seed-all-tables'
  | 'planner-shape-truncated'
  | 'record-delete-schema-potential-unavailable'
  | 'schema-partial'
  | 'schema-truncated'
  | 'traversal-truncated'
  | 'unknown-changed-field'
  | 'unknown-operation-table'
  | 'unresolved-field-metadata';

/**
 * Field metadata supplied by the caller.
 *
 * `formula` is the output of the formula collector. The model only reads
 * `contextFree`; it never parses or re-evaluates a formula.
 */
export type SchemaComplexityField = {
  readonly id: string;
  readonly tableId: string;
  readonly type: string;
  readonly isComputed: boolean;
  readonly conditional?: boolean;
  readonly formula?: FormulaProfile;
};

/**
 * A directed dependency edge: `fromFieldId` feeds `toFieldId`.
 *
 * `fromFieldId` is the referenced/upstream field, `toFieldId` is the
 * dependent/downstream field (normally a computed field).
 */
export type SchemaComplexityEdge = {
  readonly fromFieldId: string;
  readonly toFieldId: string;
  readonly fromTableId: string;
  readonly toTableId: string;
  readonly kind: SchemaEdgeKind;
  readonly linkFieldId?: string;
  readonly conditional?: boolean;
  readonly conditionFieldIds?: ReadonlyArray<string>;
};

export type PlannerPathMode = 'linkTraversal' | 'conditionalFiltered' | 'allTargetRecords';

export type PlannerOperationStep = {
  readonly tableId: string;
  readonly fieldIds: ReadonlyArray<string>;
  readonly level: number;
};
export type PathOrigin = 'dependency' | 'field-backfill';

export type PlannerOperationPath = {
  readonly fromFieldId: string;
  readonly toFieldId: string;
  readonly fromTableId: string;
  readonly toTableId: string;
  readonly mode: PlannerPathMode;
  readonly reason?: string;
  /** Defaults to `dependency`; synthetic self-backfill paths use `field-backfill`. */
  readonly origin?: PathOrigin;
  readonly linkFieldId?: string | null;
  readonly beforeImage?: PathBeforeImage;
  readonly alternativeGroup?: string | null;
  readonly level?: number;
  /** Deduplicated source-field provenance represented by this planner path. */
  readonly sourceFieldIds?: ReadonlyArray<string>;
  /** Deduplicated target-field provenance represented by this planner path. */
  readonly targetFieldIds?: ReadonlyArray<string>;
  /** Deduplicated source-field count represented by this planner path. */
  readonly sourceFieldCount?: number;
  /** Deduplicated target-field count represented by this planner path. */
  readonly targetFieldCount?: number;
};

/**
 * Exact projection of a computed-update plan.
 *
 * This is supplied by a caller that already owns plan construction. The model
 * preserves it alongside the deterministic schema-potential shape instead of
 * reconciling the two.
 */
export type PlannerOperationPlan = {
  readonly steps: ReadonlyArray<PlannerOperationStep>;
  readonly paths: ReadonlyArray<PlannerOperationPath>;
  readonly seedAllTableIds?: ReadonlyArray<string>;
  readonly cycle?: boolean;
  readonly truncated?: boolean;
  readonly beforeImage: SchemaBeforeImage;
};

/**
 * Operation descriptor. Field ids are global within a base; `tableId` is the
 * seed table for the operation.
 */
export type OperationDescriptor = {
  readonly kind: SchemaOperationKind;
  readonly tableId: string;
  readonly changedFieldIds: ReadonlyArray<string>;
  readonly beforeImage?: SchemaBeforeImage;
  readonly fieldChange?: SchemaFieldChange;
  readonly pasteMode?: SchemaPasteMode;
  readonly dataPresence?: SchemaDataPresence;
  readonly plan?: PlannerOperationPlan;
};

export type SchemaComplexityProfileInput = {
  readonly fields: ReadonlyArray<SchemaComplexityField>;
  readonly edges: ReadonlyArray<SchemaComplexityEdge>;
  readonly operation?: OperationDescriptor;
  readonly completeness?: SchemaCompleteness;
  readonly maxTraversalDepth?: number;
  /**
   * The table the caller is profiling. Counts and topology still use every
   * supplied field and edge; focus only labels scope and supplies
   * `focusTableFieldCount`.
   */
  readonly focusTableId?: string;
};

export type StructuralProfileInput = {
  readonly fields: ReadonlyArray<SchemaComplexityField>;
  readonly edges: ReadonlyArray<SchemaComplexityEdge>;
  readonly completeness?: SchemaCompleteness;
  readonly focusTableId?: string;
};

export type OperationShapeInput = {
  readonly fields: ReadonlyArray<SchemaComplexityField>;
  readonly edges: ReadonlyArray<SchemaComplexityEdge>;
  readonly operation: OperationDescriptor;
  readonly completeness?: SchemaCompleteness;
  readonly maxTraversalDepth?: number;
};

export type FormulaComplexityEntry = {
  readonly fieldId: string;
  readonly tableId: string;
  readonly profile: FormulaProfile;
};

export type StructuralDepthStatus = 'exact' | 'partial' | 'cycle' | 'truncated';

export type StructuralMissingMetadata = {
  readonly computedFieldsWithoutFormula: ReadonlyArray<string>;
  readonly crossRecordEdgesWithoutLinkField: number;
  readonly conditionalEdgesWithoutConditionFieldIds: number;
  readonly unresolvedEdgeEndpointCount: number;
  readonly unresolvedConditionFieldCount: number;
  readonly tableMismatchedEdges: number;
  readonly duplicateEdgeCount: number;
};

export type StructuralComplexityProfile = {
  readonly completeness: SchemaCompleteness;
  /** Caller-declared completeness combined with unresolved endpoints. */
  readonly effectiveCompleteness: SchemaCompleteness;
  readonly fieldCount: number;
  /** Known fields plus ids referenced only by edges or conditions. */
  readonly graphNodeCount: number;
  readonly focusTableFieldCount: number | null;
  readonly computedFieldCount: number;
  readonly edgeCount: number;
  readonly sameRecordEdgeCount: number;
  readonly crossRecordEdgeCount: number;
  readonly conditionalFieldCount: number;
  readonly conditionalEdgeCount: number;
  readonly maxUniqueOutDegree: number;
  readonly maxUniqueInDegree: number;
  /** Longest dependency chain measured in edges. `null` for cycle/truncated. */
  readonly maxDependencyDepth: number | null;
  readonly depthStatus: StructuralDepthStatus;
  /** Fields that belong to a dependency cycle. */
  readonly cycleFieldIds: ReadonlyArray<string>;
  /** Fields downstream of a cycle; these are not themselves cyclic. */
  readonly blockedFieldIds: ReadonlyArray<string>;
  readonly unresolvedFieldIds: ReadonlyArray<string>;
  readonly missingMetadata: StructuralMissingMetadata;
};

export type OperationPotentialStep = {
  readonly tableId: string;
  readonly level: number;
  readonly fieldIds: ReadonlyArray<string>;
};

export type OperationPropagationPath = {
  readonly fromFieldId: string;
  readonly toFieldId: string;
  readonly fromTableId: string;
  readonly toTableId: string;
  readonly mode: PropagationMode;
  readonly certainty: PropagationCertainty;
  readonly reason?: string;
  /** Defaults to `dependency`; synthetic self-backfill paths use `field-backfill`. */
  readonly origin: PathOrigin;
  /** Exact link identity for cross-record paths; null when absent or not applicable. */
  readonly linkFieldId: string | null;
  /** Whether the runtime path must include seed-stage before-image source rows. */
  readonly beforeImage: PathBeforeImage;
  /**
   * Non-null when this path is one possible member of a mutually exclusive
   * group (for example conditionalFiltered vs allTargetRecords). Paths in the
   * same group must not be added as independent work.
   */
  readonly alternativeGroup: string | null;
  /** Kahn/topological target level; seed/changed fields are level 0. */
  readonly level: number;
  /** Path multiplicity, not data fanout. Defaults to one when absent. */
  readonly sourceFieldIds?: ReadonlyArray<string>;
  readonly targetFieldIds?: ReadonlyArray<string>;
  readonly sourceFieldCount?: number;
  readonly targetFieldCount?: number;
};

export type SchemaPotentialOperationShape = {
  readonly potentialSteps: ReadonlyArray<OperationPotentialStep>;
  /** Number of table/level groups, not fields. */
  readonly potentialStepCount: number;
  /** Unique computed fields represented by the steps. */
  readonly potentialFieldCount: number;
  readonly potentialLevelCount: number;
  readonly propagationPaths: ReadonlyArray<OperationPropagationPath>;
  readonly propagationModeCounts: PropagationModeCounts;
  readonly blockedComputedFieldIds: ReadonlyArray<string>;
  readonly truncatedFieldIds: ReadonlyArray<string>;
  readonly truncated: boolean;
  readonly riskFlags: ReadonlyArray<OperationRiskFlag>;
};

export type PlannerOperationShape = {
  readonly source: 'planner';
  readonly steps: ReadonlyArray<PlannerOperationStep>;
  /** Number of planner steps (table/level groups), not fields. */
  readonly potentialStepCount: number;
  readonly potentialFieldCount: number;
  readonly potentialLevelCount: number;
  readonly propagationPaths: ReadonlyArray<OperationPropagationPath>;
  readonly propagationModeCounts: PropagationModeCounts;
  readonly seedAllTableIds: ReadonlyArray<string>;
  readonly cycle: boolean;
  readonly truncated: boolean;
  readonly beforeImage: SchemaBeforeImage;
  readonly riskFlags: ReadonlyArray<OperationRiskFlag>;
};

export type SchemaOperationShapeProfile = {
  readonly kind: SchemaOperationKind;
  readonly tableId: string;
  readonly fieldChange: SchemaFieldChange | null;
  readonly pasteMode: SchemaPasteMode | null;
  readonly shapeSource: 'schema-potential';
  /** Shape used for `propagationModeCounts`, `riskFlags`, and `truncated`. */
  readonly effectiveShapeSource: 'schema-potential' | 'planner';
  /** Whether the profile has enough information to bound the operation's work. */
  readonly uncertainty: 'known' | 'unknown';
  readonly changedFieldIds: ReadonlyArray<string>;
  readonly contextFreeFormulaFieldIds: ReadonlyArray<string>;
  readonly schemaPotential: SchemaPotentialOperationShape;
  readonly plannerShape: PlannerOperationShape | null;
  readonly propagationModeCounts: PropagationModeCounts;
  readonly riskFlags: ReadonlyArray<OperationRiskFlag>;
  readonly truncated: boolean;
};

export type SchemaComplexityEvidence = {
  readonly completeness: SchemaCompleteness;
  /** Descriptor-only marker. Never inferred from a plan or from row counts. */
  readonly dataPresence: SchemaDataPresence;
  readonly beforeImage: SchemaBeforeImage | null;
};

export type SchemaComplexityScope = {
  readonly focusTableId: string | null;
};

export type SchemaComplexityProfile = {
  readonly version: typeof SCHEMA_COMPLEXITY_PROFILE_VERSION;
  readonly basis: typeof SCHEMA_COMPLEXITY_BASIS;
  readonly scope: SchemaComplexityScope;
  readonly structural: StructuralComplexityProfile;
  readonly formulas: ReadonlyArray<FormulaComplexityEntry>;
  readonly operation: SchemaOperationShapeProfile | null;
  /** Additive Phase 2 estimate; absent means no data-aware estimate was requested. */
  readonly dataEstimate?: DataEstimate;
  readonly evidence: SchemaComplexityEvidence;
  readonly warnings: ReadonlyArray<string>;
};

// ---------------------------------------------------------------------------
// Internal model
// ---------------------------------------------------------------------------

type IndexedField = {
  readonly id: string;
  readonly tableId: string;
  readonly type: string;
  readonly isComputed: boolean;
  readonly conditional: boolean;
  readonly formula: FormulaProfile | undefined;
};

type NormalizedEdge = {
  readonly fromFieldId: string;
  readonly toFieldId: string;
  readonly fromTableId: string;
  readonly toTableId: string;
  readonly kind: SchemaEdgeKind;
  readonly linkFieldId: string | null;
  readonly conditional: boolean;
  readonly conditionFieldIds: ReadonlyArray<string>;
};

type EdgeIndex = {
  readonly edges: ReadonlyArray<NormalizedEdge>;
  readonly duplicateEdgeCount: number;
  readonly unresolvedEdgeEndpointCount: number;
  readonly unresolvedConditionFieldCount: number;
  readonly tableMismatchedEdges: number;
  readonly crossRecordEdgesWithoutLinkField: number;
  readonly conditionalEdgesWithoutConditionFieldIds: number;
  readonly referencedFieldIds: ReadonlyArray<string>;
  readonly unresolvedFieldIds: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
};

type SchemaModel = {
  readonly fieldsById: ReadonlyMap<string, IndexedField>;
  readonly nodes: ReadonlyArray<string>;
  readonly edges: ReadonlyArray<NormalizedEdge>;
  readonly adjacency: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly reverseAdjacency: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly tableIds: ReadonlySet<string>;
  readonly duplicateFieldIds: ReadonlyArray<string>;
  readonly unresolvedFieldIds: ReadonlyArray<string>;
  readonly missingMetadata: StructuralMissingMetadata;
  readonly warnings: ReadonlyArray<string>;
};

type CycleInfo = {
  readonly hasCycle: boolean;
  readonly cycleFieldIds: ReadonlyArray<string>;
  readonly blockedFieldIds: ReadonlyArray<string>;
};

type NormalizedOperation = {
  readonly kind: SchemaOperationKind;
  readonly tableId: string;
  readonly changedFieldIds: ReadonlyArray<string>;
  readonly beforeImage: SchemaBeforeImage;
  readonly fieldChange: SchemaFieldChange | null;
  readonly dataPresence: SchemaDataPresence;
  readonly pasteMode: SchemaPasteMode | null;
  readonly plan: NormalizedPlannerPlan | null;
};

type NormalizedPlannerPlan = {
  readonly steps: ReadonlyArray<PlannerOperationStep>;
  readonly paths: ReadonlyArray<PlannerOperationPath>;
  readonly seedAllTableIds: ReadonlyArray<string>;
  readonly cycle: boolean;
  readonly truncated: boolean;
  readonly beforeImage: SchemaBeforeImage;
  readonly beforeImageProvided: boolean;
};

type NormalizedBound = {
  readonly limit: number;
  readonly invalid: boolean;
};

type OperationNormalization = {
  readonly operation: NormalizedOperation | null;
  readonly warnings: ReadonlyArray<string>;
};

type OperationBuildResult = {
  readonly operation: SchemaOperationShapeProfile;
  readonly warnings: ReadonlyArray<string>;
};

type SchemaPotentialBuildResult = {
  readonly shape: SchemaPotentialOperationShape;
  readonly shapeRiskFlags: ReadonlyArray<OperationRiskFlag>;
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const compareStrings = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const uniqueSorted = <Value extends string>(values: Iterable<Value>): Value[] => {
  const unique = new Set<Value>();
  for (const value of values) unique.add(value);
  return [...unique].sort(compareStrings);
};

const isString = (value: unknown): value is string => typeof value === 'string';

const countPropagationModes = (
  paths: ReadonlyArray<OperationPropagationPath>
): PropagationModeCounts => {
  const counts: Record<PropagationMode, number> = {
    sameRecord: 0,
    linkTraversal: 0,
    conditionalFiltered: 0,
    allTargetRecords: 0,
    backfill: 0,
  };
  for (const path of paths) counts[path.mode] += 1;
  return counts;
};

const isOperationKind = (value: unknown): value is SchemaOperationKind =>
  value === 'update' ||
  value === 'create' ||
  value === 'delete' ||
  value === 'paste' ||
  value === 'field-change';

const isBeforeImage = (value: unknown): value is SchemaBeforeImage =>
  value === 'available' || value === 'unavailable' || value === 'unknown';

const isDataPresence = (value: unknown): value is SchemaDataPresence =>
  value === 'unknown' || value === 'empty';

const isFieldChange = (value: unknown): value is SchemaFieldChange =>
  value === 'create' || value === 'update' || value === 'delete' || value === 'convert';

const isPasteMode = (value: unknown): value is SchemaPasteMode =>
  value === 'insert' || value === 'update' || value === 'mixed';

const isPlannerPathMode = (value: unknown): value is PlannerPathMode =>
  value === 'linkTraversal' || value === 'conditionalFiltered' || value === 'allTargetRecords';

const isCompleteness = (value: unknown): value is SchemaCompleteness =>
  value === 'complete' || value === 'partial' || value === 'truncated';

const isPathOrigin = (value: unknown): value is PathOrigin =>
  value === 'dependency' || value === 'field-backfill';

const normalizeCompleteness = (value: SchemaCompleteness | undefined): SchemaCompleteness =>
  isCompleteness(value) ? value : 'partial';

// ---------------------------------------------------------------------------
// Model preparation
// ---------------------------------------------------------------------------

const normalizeField = (field: SchemaComplexityField): IndexedField => ({
  id: field.id,
  tableId: field.tableId,
  type: field.type,
  isComputed: field.isComputed === true,
  conditional: field.conditional === true,
  formula: field.formula,
});

const prepareFields = (
  fields: ReadonlyArray<SchemaComplexityField>
): {
  readonly fieldsById: Map<string, IndexedField>;
  readonly duplicateFieldIds: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
} => {
  const fieldsById = new Map<string, IndexedField>();
  const duplicateFieldIds = new Set<string>();
  const warnings = new Set<string>();

  for (const field of fields) {
    if (fieldsById.has(field.id)) {
      duplicateFieldIds.add(field.id);
      warnings.add(`duplicate-field-id:${field.id}`);
      continue;
    }
    fieldsById.set(field.id, normalizeField(field));
  }

  for (const field of fieldsById.values()) {
    if (field.type === 'formula' && field.formula === undefined) {
      warnings.add(`computed-field-without-formula:${field.id}`);
    }
    if (!field.isComputed && field.formula !== undefined) {
      warnings.add(`formula-on-non-computed-field:${field.id}`);
    }
  }

  return {
    fieldsById,
    duplicateFieldIds: uniqueSorted(duplicateFieldIds),
    warnings: uniqueSorted(warnings),
  };
};

const normalizeEdge = (edge: SchemaComplexityEdge): NormalizedEdge => {
  const conditionFieldIds = uniqueSorted(edge.conditionFieldIds ?? []);
  return {
    fromFieldId: edge.fromFieldId,
    toFieldId: edge.toFieldId,
    fromTableId: edge.fromTableId,
    toTableId: edge.toTableId,
    kind: edge.kind,
    linkFieldId: edge.linkFieldId ?? null,
    conditional: edge.conditional === true || conditionFieldIds.length > 0,
    conditionFieldIds,
  };
};

const edgeKey = (edge: NormalizedEdge): string =>
  [
    edge.fromFieldId,
    edge.toFieldId,
    edge.fromTableId,
    edge.toTableId,
    edge.kind,
    edge.linkFieldId ?? '',
    edge.conditional ? '1' : '0',
    edge.conditionFieldIds.join(','),
  ].join('\u0000');

type EdgeClassification = {
  readonly edge: NormalizedEdge;
  readonly fromKnown: boolean;
  readonly toKnown: boolean;
  readonly tableMismatch: boolean;
  readonly missingLinkField: boolean;
  readonly missingConditionFields: boolean;
  readonly unknownConditionFieldIds: ReadonlyArray<string>;
};

type EdgeSummary = {
  readonly unresolvedFieldIds: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly unresolvedEdgeEndpointCount: number;
  readonly unresolvedConditionFieldCount: number;
  readonly tableMismatchedEdges: number;
  readonly crossRecordEdgesWithoutLinkField: number;
  readonly conditionalEdgesWithoutConditionFieldIds: number;
};

const classifyEdge = (
  edge: NormalizedEdge,
  fieldsById: ReadonlyMap<string, IndexedField>
): EdgeClassification => {
  const fromField = fieldsById.get(edge.fromFieldId);
  const toField = fieldsById.get(edge.toFieldId);
  return {
    edge,
    fromKnown: fromField !== undefined,
    toKnown: toField !== undefined,
    tableMismatch:
      fromField !== undefined &&
      toField !== undefined &&
      (fromField.tableId !== edge.fromTableId || toField.tableId !== edge.toTableId),
    missingLinkField: edge.kind === 'cross_record' && edge.linkFieldId === null,
    missingConditionFields: edge.conditional && edge.conditionFieldIds.length === 0,
    unknownConditionFieldIds: edge.conditionFieldIds.filter((fieldId) => !fieldsById.has(fieldId)),
  };
};

const summarizeEdge = (classification: EdgeClassification): EdgeSummary => {
  const { edge, fromKnown, toKnown } = classification;
  const arrow = `${edge.fromFieldId}->${edge.toFieldId}`;
  return {
    unresolvedFieldIds: [
      ...(fromKnown ? [] : [edge.fromFieldId]),
      ...(toKnown ? [] : [edge.toFieldId]),
      ...classification.unknownConditionFieldIds,
    ],
    warnings: [
      ...(fromKnown ? [] : [`unresolved-edge-endpoint:${edge.fromFieldId}`]),
      ...(toKnown ? [] : [`unresolved-edge-endpoint:${edge.toFieldId}`]),
      ...(classification.tableMismatch ? [`edge-table-mismatch:${arrow}`] : []),
      ...(classification.missingLinkField ? [`cross-record-edge-without-link-field:${arrow}`] : []),
      ...(classification.missingConditionFields
        ? [`conditional-edge-without-condition-fields:${arrow}`]
        : []),
      ...classification.unknownConditionFieldIds.map(
        (fieldId) => `unresolved-condition-field:${fieldId}`
      ),
    ],
    unresolvedEdgeEndpointCount: fromKnown && toKnown ? 0 : 1,
    unresolvedConditionFieldCount: classification.unknownConditionFieldIds.length,
    tableMismatchedEdges: classification.tableMismatch ? 1 : 0,
    crossRecordEdgesWithoutLinkField: classification.missingLinkField ? 1 : 0,
    conditionalEdgesWithoutConditionFieldIds: classification.missingConditionFields ? 1 : 0,
  };
};

const prepareEdges = (
  edges: ReadonlyArray<SchemaComplexityEdge>,
  fieldsById: ReadonlyMap<string, IndexedField>
): EdgeIndex => {
  const seen = new Set<string>();
  const accepted: NormalizedEdge[] = [];
  const referencedFieldIds = new Set<string>();
  const unresolvedFieldIds = new Set<string>();
  const warnings = new Set<string>();
  let duplicateEdgeCount = 0;
  let unresolvedEdgeEndpointCount = 0;
  let unresolvedConditionFieldCount = 0;
  let tableMismatchedEdges = 0;
  let crossRecordEdgesWithoutLinkField = 0;
  let conditionalEdgesWithoutConditionFieldIds = 0;

  for (const rawEdge of edges) {
    const edge = normalizeEdge(rawEdge);
    const key = edgeKey(edge);
    if (seen.has(key)) {
      duplicateEdgeCount += 1;
      warnings.add(`duplicate-edge:${edge.fromFieldId}->${edge.toFieldId}`);
      continue;
    }
    seen.add(key);
    accepted.push(edge);
    referencedFieldIds.add(edge.fromFieldId);
    referencedFieldIds.add(edge.toFieldId);

    const summary = summarizeEdge(classifyEdge(edge, fieldsById));
    for (const fieldId of summary.unresolvedFieldIds) unresolvedFieldIds.add(fieldId);
    for (const warning of summary.warnings) warnings.add(warning);
    for (const conditionFieldId of edge.conditionFieldIds) {
      referencedFieldIds.add(conditionFieldId);
    }
    unresolvedEdgeEndpointCount += summary.unresolvedEdgeEndpointCount;
    unresolvedConditionFieldCount += summary.unresolvedConditionFieldCount;
    tableMismatchedEdges += summary.tableMismatchedEdges;
    crossRecordEdgesWithoutLinkField += summary.crossRecordEdgesWithoutLinkField;
    conditionalEdgesWithoutConditionFieldIds += summary.conditionalEdgesWithoutConditionFieldIds;
  }

  accepted.sort((left, right) => compareStrings(edgeKey(left), edgeKey(right)));

  return {
    edges: accepted,
    duplicateEdgeCount,
    unresolvedEdgeEndpointCount,
    unresolvedConditionFieldCount,
    tableMismatchedEdges,
    crossRecordEdgesWithoutLinkField,
    conditionalEdgesWithoutConditionFieldIds,
    referencedFieldIds: uniqueSorted(referencedFieldIds),
    unresolvedFieldIds: uniqueSorted(unresolvedFieldIds),
    warnings: uniqueSorted(warnings),
  };
};

const addNeighbor = (sets: Map<string, Set<string>>, from: string, to: string): void => {
  const existing = sets.get(from);
  if (existing) {
    existing.add(to);
    return;
  }
  sets.set(from, new Set([to]));
};

const buildAdjacency = (
  nodes: ReadonlyArray<string>,
  edges: ReadonlyArray<NormalizedEdge>
): {
  readonly adjacency: Map<string, ReadonlyArray<string>>;
  readonly reverseAdjacency: Map<string, ReadonlyArray<string>>;
} => {
  const forwardSets = new Map<string, Set<string>>();
  const reverseSets = new Map<string, Set<string>>();
  for (const node of nodes) {
    forwardSets.set(node, new Set());
    reverseSets.set(node, new Set());
  }
  for (const edge of edges) {
    addNeighbor(forwardSets, edge.fromFieldId, edge.toFieldId);
    addNeighbor(reverseSets, edge.toFieldId, edge.fromFieldId);
  }

  const sorted = (sets: Map<string, Set<string>>): Map<string, ReadonlyArray<string>> => {
    const result = new Map<string, ReadonlyArray<string>>();
    for (const [node, neighbors] of sets) {
      result.set(node, [...neighbors].sort(compareStrings));
    }
    return result;
  };

  return {
    adjacency: sorted(forwardSets),
    reverseAdjacency: sorted(reverseSets),
  };
};

const prepareModel = (input: {
  readonly fields: ReadonlyArray<SchemaComplexityField>;
  readonly edges: ReadonlyArray<SchemaComplexityEdge>;
}): SchemaModel => {
  const fields = prepareFields(input.fields);
  const edgeIndex = prepareEdges(input.edges, fields.fieldsById);

  const nodeIds = new Set<string>(fields.fieldsById.keys());
  for (const fieldId of edgeIndex.referencedFieldIds) nodeIds.add(fieldId);
  const nodes = uniqueSorted(nodeIds);

  const { adjacency, reverseAdjacency } = buildAdjacency(nodes, edgeIndex.edges);

  return {
    fieldsById: fields.fieldsById,
    nodes,
    edges: edgeIndex.edges,
    adjacency,
    reverseAdjacency,
    tableIds: new Set([...fields.fieldsById.values()].map((field) => field.tableId)),
    duplicateFieldIds: fields.duplicateFieldIds,
    unresolvedFieldIds: edgeIndex.unresolvedFieldIds,
    missingMetadata: {
      computedFieldsWithoutFormula: uniqueSorted(
        [...fields.fieldsById.values()]
          .filter((field) => field.type === 'formula' && field.formula === undefined)
          .map((field) => field.id)
      ),
      crossRecordEdgesWithoutLinkField: edgeIndex.crossRecordEdgesWithoutLinkField,
      conditionalEdgesWithoutConditionFieldIds: edgeIndex.conditionalEdgesWithoutConditionFieldIds,
      unresolvedEdgeEndpointCount: edgeIndex.unresolvedEdgeEndpointCount,
      unresolvedConditionFieldCount: edgeIndex.unresolvedConditionFieldCount,
      tableMismatchedEdges: edgeIndex.tableMismatchedEdges,
      duplicateEdgeCount: edgeIndex.duplicateEdgeCount,
    },
    warnings: uniqueSorted([...fields.warnings, ...edgeIndex.warnings]),
  };
};

// ---------------------------------------------------------------------------
// Graph algorithms (all iterative; no recursion over field graphs)
// ---------------------------------------------------------------------------

const computeFinishOrder = (model: SchemaModel): string[] => {
  const visited = new Set<string>();
  const finishOrder: string[] = [];

  for (const start of model.nodes) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack: Array<{ readonly node: string; index: number }> = [{ node: start, index: 0 }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame) break;
      const neighbors = model.adjacency.get(frame.node) ?? [];
      if (frame.index >= neighbors.length) {
        finishOrder.push(frame.node);
        stack.pop();
        continue;
      }
      const next = neighbors[frame.index];
      frame.index += 1;
      if (next !== undefined && !visited.has(next)) {
        visited.add(next);
        stack.push({ node: next, index: 0 });
      }
    }
  }

  return finishOrder;
};

const findCycleNodes = (model: SchemaModel, finishOrder: ReadonlyArray<string>): Set<string> => {
  const assigned = new Set<string>();
  const cycleNodes = new Set<string>();

  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const start = finishOrder[index];
    if (start === undefined || assigned.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    assigned.add(start);

    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined) continue;
      component.push(node);
      for (const predecessor of model.reverseAdjacency.get(node) ?? []) {
        if (!assigned.has(predecessor)) {
          assigned.add(predecessor);
          stack.push(predecessor);
        }
      }
    }

    const selfLoop = (model.adjacency.get(start) ?? []).includes(start);
    if (component.length > 1 || selfLoop) {
      for (const node of component) cycleNodes.add(node);
    }
  }

  return cycleNodes;
};

const seedBlockedNodes = (
  model: SchemaModel,
  cycleNodes: ReadonlySet<string>
): { readonly blockedNodes: Set<string>; readonly queue: string[] } => {
  const blockedNodes = new Set<string>();
  const queue: string[] = [];
  for (const node of model.nodes) {
    if (!cycleNodes.has(node)) continue;
    for (const neighbor of model.adjacency.get(node) ?? []) {
      if (!cycleNodes.has(neighbor) && !blockedNodes.has(neighbor)) {
        blockedNodes.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return { blockedNodes, queue };
};

const expandBlockedNodes = (
  model: SchemaModel,
  cycleNodes: ReadonlySet<string>,
  blockedNodes: Set<string>,
  queue: string[]
): void => {
  let cursor = 0;
  while (cursor < queue.length) {
    const node = queue[cursor];
    cursor += 1;
    if (node === undefined) continue;
    for (const neighbor of model.adjacency.get(node) ?? []) {
      if (!cycleNodes.has(neighbor) && !blockedNodes.has(neighbor)) {
        blockedNodes.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
};

const findCycleInfo = (model: SchemaModel): CycleInfo => {
  const finishOrder = computeFinishOrder(model);
  const cycleNodes = findCycleNodes(model, finishOrder);
  const seeded = seedBlockedNodes(model, cycleNodes);
  expandBlockedNodes(model, cycleNodes, seeded.blockedNodes, seeded.queue);

  return {
    hasCycle: cycleNodes.size > 0,
    cycleFieldIds: uniqueSorted(cycleNodes),
    blockedFieldIds: uniqueSorted(seeded.blockedNodes),
  };
};

const computeIndegree = (
  nodes: ReadonlyArray<string>,
  adjacency: ReadonlyMap<string, ReadonlyArray<string>>,
  active: ReadonlySet<string>
): Map<string, number> => {
  const indegree = new Map<string, number>();
  for (const node of nodes) indegree.set(node, 0);
  for (const node of nodes) {
    for (const neighbor of adjacency.get(node) ?? []) {
      if (active.has(neighbor)) {
        indegree.set(neighbor, (indegree.get(neighbor) ?? 0) + 1);
      }
    }
  }
  return indegree;
};

const computeKahnLevels = (
  nodes: ReadonlyArray<string>,
  adjacency: ReadonlyMap<string, ReadonlyArray<string>>,
  active: ReadonlySet<string>
): { readonly levels: Map<string, number>; readonly processed: number } => {
  const indegree = computeIndegree(nodes, adjacency, active);
  const levels = new Map<string, number>();
  const queue: string[] = [];
  for (const node of nodes) {
    if ((indegree.get(node) ?? 0) === 0) {
      levels.set(node, 0);
      queue.push(node);
    }
  }

  let cursor = 0;
  let processed = 0;
  while (cursor < queue.length) {
    const node = queue[cursor];
    cursor += 1;
    if (node === undefined) continue;
    processed += 1;
    const nodeLevel = levels.get(node) ?? 0;
    for (const neighbor of adjacency.get(node) ?? []) {
      if (!active.has(neighbor)) continue;
      const candidate = nodeLevel + 1;
      if (candidate > (levels.get(neighbor) ?? 0)) levels.set(neighbor, candidate);
      const nextIndegree = (indegree.get(neighbor) ?? 0) - 1;
      indegree.set(neighbor, nextIndegree);
      if (nextIndegree === 0) queue.push(neighbor);
    }
  }

  return { levels, processed };
};

const computeMaxDependencyDepth = (
  nodes: ReadonlyArray<string>,
  adjacency: ReadonlyMap<string, ReadonlyArray<string>>
): number | null => {
  if (nodes.length === 0) return 0;
  const active = new Set(nodes);
  const { levels, processed } = computeKahnLevels(nodes, adjacency, active);
  if (processed !== nodes.length) return null;

  let maximum = 0;
  for (const value of levels.values()) {
    if (value > maximum) maximum = value;
  }
  return maximum;
};

const maxDegree = (
  nodes: ReadonlyArray<string>,
  adjacency: ReadonlyMap<string, ReadonlyArray<string>>
): number => {
  let maximum = 0;
  for (const node of nodes) {
    const degree = (adjacency.get(node) ?? []).length;
    if (degree > maximum) maximum = degree;
  }
  return maximum;
};

const collectReachable = (
  seeds: Iterable<string>,
  adjacency: ReadonlyMap<string, ReadonlyArray<string>>
): Set<string> => {
  const reachable = new Set<string>();
  const stack = uniqueSorted(seeds);
  for (const seed of stack) reachable.add(seed);

  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;
    for (const neighbor of adjacency.get(node) ?? []) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        stack.push(neighbor);
      }
    }
  }

  return reachable;
};

/**
 * Longest-path levels inside the reachable acyclic part of the graph.
 *
 * Nodes that are cyclic or downstream of a cycle have no finite level and are
 * omitted. The traversal is iterative and bound by the reachable set.
 */
const computeLevels = (
  reachable: ReadonlySet<string>,
  blockedReachable: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, ReadonlyArray<string>>
): Map<string, number> => {
  const activeNodes = uniqueSorted([...reachable].filter((node) => !blockedReachable.has(node)));
  const active = new Set(activeNodes);
  return computeKahnLevels(activeNodes, adjacency, active).levels;
};

// ---------------------------------------------------------------------------
// Structural profile
// ---------------------------------------------------------------------------

const buildStructuralFromModel = (
  model: SchemaModel,
  declaredCompleteness: SchemaCompleteness,
  focusTableId: string | null
): StructuralComplexityProfile => {
  const knownFields = [...model.fieldsById.values()];
  const cycleInfo = findCycleInfo(model);
  const effectiveCompleteness: SchemaCompleteness =
    declaredCompleteness === 'truncated'
      ? 'truncated'
      : declaredCompleteness === 'partial' || model.unresolvedFieldIds.length > 0
        ? 'partial'
        : 'complete';

  const depthStatus: StructuralDepthStatus =
    effectiveCompleteness === 'truncated'
      ? 'truncated'
      : cycleInfo.hasCycle
        ? 'cycle'
        : effectiveCompleteness === 'partial'
          ? 'partial'
          : 'exact';

  const maxDependencyDepth =
    depthStatus === 'truncated' || depthStatus === 'cycle'
      ? null
      : computeMaxDependencyDepth(model.nodes, model.adjacency);

  const sameRecordEdgeCount = model.edges.filter((edge) => edge.kind === 'same_record').length;
  const crossRecordEdgeCount = model.edges.length - sameRecordEdgeCount;

  return {
    completeness: declaredCompleteness,
    effectiveCompleteness,
    fieldCount: knownFields.length,
    graphNodeCount: model.nodes.length,
    focusTableFieldCount:
      focusTableId === null
        ? null
        : knownFields.filter((field) => field.tableId === focusTableId).length,
    computedFieldCount: knownFields.filter((field) => field.isComputed).length,
    edgeCount: model.edges.length,
    sameRecordEdgeCount,
    crossRecordEdgeCount,
    conditionalFieldCount: knownFields.filter((field) => field.conditional).length,
    conditionalEdgeCount: model.edges.filter((edge) => edge.conditional).length,
    maxUniqueOutDegree: maxDegree(model.nodes, model.adjacency),
    maxUniqueInDegree: maxDegree(model.nodes, model.reverseAdjacency),
    maxDependencyDepth,
    depthStatus,
    cycleFieldIds: cycleInfo.cycleFieldIds,
    blockedFieldIds: cycleInfo.blockedFieldIds,
    unresolvedFieldIds: model.unresolvedFieldIds,
    missingMetadata: model.missingMetadata,
  };
};

// ---------------------------------------------------------------------------
// Operation normalization
// ---------------------------------------------------------------------------

const normalizePlannerPlan = (
  plan: PlannerOperationPlan | undefined,
  fallbackBeforeImage: SchemaBeforeImage
): { readonly plan: NormalizedPlannerPlan | null; readonly warnings: ReadonlyArray<string> } => {
  if (plan === undefined) return { plan: null, warnings: [] };

  const warnings = new Set<string>();
  const beforeImageProvided = isBeforeImage(plan.beforeImage);
  if (!beforeImageProvided) warnings.add('planner-before-image-missing');

  const paths: PlannerOperationPath[] = [];
  for (const path of plan.paths) {
    if (!isPlannerPathMode(path.mode)) {
      warnings.add(`invalid-planner-path-mode:${String(path.mode)}`);
      continue;
    }
    let origin: PathOrigin = 'dependency';
    if (path.origin !== undefined) {
      if (isPathOrigin(path.origin)) {
        origin = path.origin;
      } else {
        warnings.add(`invalid-planner-path-origin:${String(path.origin)}`);
      }
    }
    paths.push({
      fromFieldId: path.fromFieldId,
      toFieldId: path.toFieldId,
      fromTableId: path.fromTableId,
      toTableId: path.toTableId,
      mode: path.mode,
      origin,
      linkFieldId: path.linkFieldId ?? null,
      ...(path.beforeImage === undefined ? {} : { beforeImage: path.beforeImage }),
      alternativeGroup: path.alternativeGroup ?? null,
      ...(path.level === undefined ? {} : { level: path.level }),
      ...(path.reason === undefined ? {} : { reason: path.reason }),
      ...(path.sourceFieldIds === undefined ? {} : { sourceFieldIds: path.sourceFieldIds }),
      ...(path.targetFieldIds === undefined ? {} : { targetFieldIds: path.targetFieldIds }),
      ...(path.sourceFieldCount === undefined ? {} : { sourceFieldCount: path.sourceFieldCount }),
      ...(path.targetFieldCount === undefined ? {} : { targetFieldCount: path.targetFieldCount }),
    });
  }

  return {
    plan: {
      steps: plan.steps.map((step) => ({
        tableId: step.tableId,
        fieldIds: [...step.fieldIds],
        level: step.level,
      })),
      paths,
      seedAllTableIds: uniqueSorted(plan.seedAllTableIds ?? []),
      cycle: plan.cycle === true,
      truncated: plan.truncated === true,
      beforeImage: beforeImageProvided ? plan.beforeImage : fallbackBeforeImage,
      beforeImageProvided,
    },
    warnings: uniqueSorted(warnings),
  };
};

type OperationAnnotations = {
  readonly beforeImage: SchemaBeforeImage;
  readonly dataPresence: SchemaDataPresence;
  readonly fieldChange: SchemaFieldChange | null;
  readonly pasteMode: SchemaPasteMode | null;
  readonly warnings: ReadonlyArray<string>;
};

const normalizeOperationAnnotations = (
  input: OperationDescriptor,
  kind: SchemaOperationKind
): OperationAnnotations => {
  const warnings = new Set<string>();

  let beforeImage: SchemaBeforeImage = 'unknown';
  if (isBeforeImage(input.beforeImage)) {
    beforeImage = input.beforeImage;
  } else if (input.beforeImage !== undefined) {
    warnings.add(`invalid-before-image:${String(input.beforeImage)}`);
  }

  let dataPresence: SchemaDataPresence = 'unknown';
  if (isDataPresence(input.dataPresence)) {
    dataPresence = input.dataPresence;
  } else if (input.dataPresence !== undefined) {
    warnings.add(`invalid-data-presence:${String(input.dataPresence)}`);
  }

  let fieldChange: SchemaFieldChange | null = null;
  if (kind === 'field-change') {
    if (isFieldChange(input.fieldChange)) {
      fieldChange = input.fieldChange;
    } else {
      warnings.add('field-change-without-field-change');
    }
  } else if (input.fieldChange !== undefined) {
    warnings.add(`ignored-field-change:${String(input.fieldChange)}`);
  }

  let pasteMode: SchemaPasteMode | null = null;
  if (kind === 'paste') {
    if (isPasteMode(input.pasteMode)) {
      pasteMode = input.pasteMode;
    } else {
      warnings.add('paste-without-paste-mode');
    }
  } else if (input.pasteMode !== undefined) {
    warnings.add(`ignored-paste-mode:${String(input.pasteMode)}`);
  }

  return {
    beforeImage,
    dataPresence,
    fieldChange,
    pasteMode,
    warnings: uniqueSorted(warnings),
  };
};

const normalizeOperation = (input: OperationDescriptor | undefined): OperationNormalization => {
  if (input === undefined) return { operation: null, warnings: [] };

  if (!isOperationKind(input.kind)) {
    return {
      operation: null,
      warnings: [`invalid-operation-kind:${String(input.kind)}`],
    };
  }

  const warnings = new Set<string>();
  const tableId = isString(input.tableId) ? input.tableId : '';
  if (tableId.length === 0) warnings.add('empty-operation-table-id');

  const annotations = normalizeOperationAnnotations(input, input.kind);
  for (const warning of annotations.warnings) warnings.add(warning);

  const plan = normalizePlannerPlan(input.plan, annotations.beforeImage);
  for (const warning of plan.warnings) warnings.add(warning);

  return {
    operation: {
      kind: input.kind,
      tableId,
      changedFieldIds: uniqueSorted((input.changedFieldIds ?? []).filter(isString)),
      beforeImage: annotations.beforeImage,
      fieldChange: annotations.fieldChange,
      dataPresence: annotations.dataPresence,
      pasteMode: annotations.pasteMode,
      plan: plan.plan,
    },
    warnings: uniqueSorted(warnings),
  };
};

const normalizeBound = (maxTraversalDepth: number | undefined): NormalizedBound => {
  if (maxTraversalDepth === undefined) {
    return { limit: Number.POSITIVE_INFINITY, invalid: false };
  }
  if (Number.isInteger(maxTraversalDepth) && maxTraversalDepth >= 0) {
    return { limit: maxTraversalDepth, invalid: false };
  }
  return { limit: Number.POSITIVE_INFINITY, invalid: true };
};

// ---------------------------------------------------------------------------
// Schema-potential operation shape
// ---------------------------------------------------------------------------

const findContextFreeFormulaFieldIds = (
  fieldsById: ReadonlyMap<string, IndexedField>,
  tableId: string
): ReadonlyArray<string> =>
  uniqueSorted(
    [...fieldsById.values()]
      .filter(
        (field) =>
          field.tableId === tableId && field.isComputed && field.formula?.contextFree === true
      )
      .map((field) => field.id)
  );

const findTableComputedFieldIds = (
  fieldsById: ReadonlyMap<string, IndexedField>,
  tableId: string
): ReadonlyArray<string> =>
  uniqueSorted(
    [...fieldsById.values()]
      .filter((field) => field.tableId === tableId && field.isComputed)
      .map((field) => field.id)
  );

const findTableFieldIds = (
  fieldsById: ReadonlyMap<string, IndexedField>,
  tableId: string
): ReadonlyArray<string> =>
  uniqueSorted(
    [...fieldsById.values()].filter((field) => field.tableId === tableId).map((field) => field.id)
  );

const isInsertLike = (operation: NormalizedOperation): boolean =>
  operation.kind === 'create' ||
  (operation.kind === 'paste' &&
    (operation.pasteMode === 'insert' || operation.pasteMode === 'mixed'));

const includesContextFreeSeeds = (operation: NormalizedOperation): boolean =>
  operation.kind === 'update' ||
  operation.kind === 'create' ||
  operation.kind === 'paste' ||
  (operation.kind === 'field-change' &&
    (operation.fieldChange === 'create' || operation.fieldChange === 'update'));

type PropagationBase = Pick<
  OperationPropagationPath,
  'fromFieldId' | 'toFieldId' | 'fromTableId' | 'toTableId' | 'level'
>;

type PropagationVariants = {
  readonly paths: ReadonlyArray<OperationPropagationPath>;
  readonly riskFlags: ReadonlyArray<OperationRiskFlag>;
};

const resolvePropagationVariants = (
  edge: NormalizedEdge,
  base: PropagationBase,
  options: {
    readonly changedFieldIds: ReadonlySet<string>;
    readonly backfillChange: 'create' | 'update' | 'convert' | null;
    readonly beforeImage: SchemaBeforeImage;
  }
): PropagationVariants => {
  const paths: OperationPropagationPath[] = [];
  const riskFlags: OperationRiskFlag[] = [];
  const linkFieldId = edge.linkFieldId ?? null;
  const backfill = options.backfillChange !== null && options.changedFieldIds.has(edge.fromFieldId);

  if (backfill) {
    paths.push({
      ...base,
      mode: 'backfill',
      certainty: 'structural',
      origin: 'dependency',
      reason: `field-change-${options.backfillChange}-backfill`,
      linkFieldId,
      beforeImage: 'not-required',
      alternativeGroup: null,
    });
  }

  if (edge.conditional) {
    const beforeImageKnown = options.beforeImage === 'available';
    const alternativeGroup = beforeImageKnown
      ? null
      : [
          base.fromFieldId,
          base.toFieldId,
          base.fromTableId,
          base.toTableId,
          linkFieldId ?? '',
        ].join('\u0000');
    paths.push({
      ...base,
      mode: 'conditionalFiltered',
      certainty: beforeImageKnown ? 'structural' : 'possible',
      origin: 'dependency',
      reason:
        edge.conditionFieldIds.length === 0
          ? 'conditional-without-condition-fields'
          : `condition-fields:${edge.conditionFieldIds.join(',')}`,
      linkFieldId,
      beforeImage: beforeImageKnown ? 'included' : 'unknown',
      alternativeGroup,
    });
    if (!beforeImageKnown) {
      paths.push({
        ...base,
        mode: 'allTargetRecords',
        certainty: 'possible',
        origin: 'dependency',
        reason: `before-image-${options.beforeImage}`,
        linkFieldId,
        beforeImage: 'not-required',
        alternativeGroup,
      });
      riskFlags.push('conditional-before-image-unknown', 'conditional-all-target-possible');
    }
    if (edge.conditionFieldIds.length === 0) {
      riskFlags.push('missing-condition-metadata');
    }
  } else if (!backfill && edge.kind === 'cross_record') {
    paths.push({
      ...base,
      mode: 'linkTraversal',
      certainty: 'structural',
      origin: 'dependency',
      reason: linkFieldId === null ? 'cross-record-without-link-field' : `link-field:${linkFieldId}`,
      linkFieldId,
      beforeImage: 'not-required',
      alternativeGroup: null,
    });
  } else if (!backfill) {
    paths.push({
      ...base,
      mode: 'sameRecord',
      certainty: 'structural',
      origin: 'dependency',
      linkFieldId: null,
      beforeImage: 'not-required',
      alternativeGroup: null,
    });
  }

  if (edge.kind === 'cross_record' && edge.linkFieldId === null) {
    riskFlags.push('missing-link-metadata');
  }

  return { paths, riskFlags: uniqueSorted(riskFlags) };
};

const buildSchemaPropagationPaths = (input: {
  readonly edges: ReadonlyArray<NormalizedEdge>;
  readonly reachable: ReadonlySet<string>;
  readonly blockedReachable: ReadonlySet<string>;
  readonly levels: ReadonlyMap<string, number>;
  readonly limit: number;
  readonly changedFieldIds: ReadonlySet<string>;
  readonly backfillChange: 'create' | 'update' | 'convert' | null;
  readonly beforeImage: SchemaBeforeImage;
}): {
  readonly paths: ReadonlyArray<OperationPropagationPath>;
  readonly riskFlags: ReadonlyArray<OperationRiskFlag>;
} => {
  const pathsByKey = new Map<string, OperationPropagationPath>();
  const riskFlags = new Set<OperationRiskFlag>();

  const addPath = (
    path: Omit<OperationPropagationPath, 'origin'> & { readonly origin?: PathOrigin }
  ): void => {
    const normalized: OperationPropagationPath = { ...path, origin: path.origin ?? 'dependency' };
    const key = [
      normalized.fromFieldId,
      normalized.toFieldId,
      normalized.fromTableId,
      normalized.toTableId,
      normalized.mode,
      normalized.certainty,
      normalized.origin,
      normalized.linkFieldId ?? '',
      normalized.beforeImage,
      normalized.alternativeGroup ?? '',
      String(normalized.level),
      normalized.sourceFieldIds?.join(',') ?? '',
      normalized.targetFieldIds?.join(',') ?? '',
      normalized.reason ?? '',
    ].join('\u0000');
    pathsByKey.set(key, normalized);
  };

  for (const edge of input.edges) {
    if (!input.reachable.has(edge.fromFieldId)) continue;
    const fromLevel = input.levels.get(edge.fromFieldId);
    const toLevel = input.levels.get(edge.toFieldId);
    if (fromLevel !== undefined && fromLevel > input.limit) continue;
    if (toLevel !== undefined && toLevel > input.limit) continue;
    if (fromLevel === undefined && !input.blockedReachable.has(edge.fromFieldId)) continue;
    if (toLevel === undefined && !input.blockedReachable.has(edge.toFieldId)) continue;

    const variants = resolvePropagationVariants(
      edge,
      {
        fromFieldId: edge.fromFieldId,
        toFieldId: edge.toFieldId,
        fromTableId: edge.fromTableId,
        toTableId: edge.toTableId,
        level: toLevel ?? 0,
      },
      {
        changedFieldIds: input.changedFieldIds,
        backfillChange: input.backfillChange,
        beforeImage: input.beforeImage,
      }
    );

    for (const path of variants.paths) addPath(path);
    for (const riskFlag of variants.riskFlags) riskFlags.add(riskFlag);
  }

  const paths = [...pathsByKey.values()].sort((left, right) => {
    let comparison = compareStrings(left.fromTableId, right.fromTableId);
    if (comparison !== 0) return comparison;
    comparison = compareStrings(left.fromFieldId, right.fromFieldId);
    if (comparison !== 0) return comparison;
    comparison = compareStrings(left.toTableId, right.toTableId);
    if (comparison !== 0) return comparison;
    comparison = compareStrings(left.toFieldId, right.toFieldId);
    if (comparison !== 0) return comparison;
    comparison = compareStrings(left.mode, right.mode);
    if (comparison !== 0) return comparison;
    comparison = compareStrings(left.certainty, right.certainty);
    if (comparison !== 0) return comparison;
    return compareStrings(left.reason ?? '', right.reason ?? '');
  });

  return { paths, riskFlags: uniqueSorted(riskFlags) };
};

const propagationPathKey = (path: OperationPropagationPath): string =>
  [
    path.fromTableId,
    path.fromFieldId,
    path.toTableId,
    path.toFieldId,
    path.mode,
    path.certainty,
    path.origin ?? 'dependency',
    path.sourceFieldIds?.join(',') ?? '',
    path.targetFieldIds?.join(',') ?? '',
    path.sourceFieldCount ?? 1,
    path.targetFieldCount ?? 1,
    path.reason ?? '',
  ].join('\u0000');

const mergePropagationPaths = (
  groups: ReadonlyArray<ReadonlyArray<OperationPropagationPath>>
): ReadonlyArray<OperationPropagationPath> => {
  const byKey = new Map<string, OperationPropagationPath>();
  for (const group of groups) {
    for (const path of group) byKey.set(propagationPathKey(path), path);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([, path]) => path);
};

const buildSelfBackfillPaths = (input: {
  readonly operation: NormalizedOperation;
  readonly backfillChange: 'create' | 'update' | 'convert' | null;
  readonly fieldsById: ReadonlyMap<string, IndexedField>;
  readonly blockedFieldIds: ReadonlySet<string>;
}): {
  readonly paths: ReadonlyArray<OperationPropagationPath>;
  readonly riskFlags: ReadonlyArray<OperationRiskFlag>;
} => {
  if (input.backfillChange === null) return { paths: [], riskFlags: [] };

  const paths: OperationPropagationPath[] = [];
  const riskFlags = new Set<OperationRiskFlag>();

  for (const fieldId of input.operation.changedFieldIds) {
    const field = input.fieldsById.get(fieldId);
    if (field === undefined) {
      if (input.backfillChange === 'convert') riskFlags.add('field-convert-work-unknown');
      continue;
    }
    if (!field.isComputed && input.backfillChange !== 'convert') continue;
    if (field.tableId !== input.operation.tableId) continue;
    if (input.blockedFieldIds.has(fieldId)) continue;
    paths.push({
      fromFieldId: fieldId,
      toFieldId: fieldId,
      fromTableId: field.tableId,
      toTableId: field.tableId,
      mode: 'backfill',
      certainty: 'structural',
      origin: 'field-backfill',
      reason: `field-change-${input.backfillChange}-self-backfill`,
      linkFieldId: null,
      beforeImage: 'not-required',
      alternativeGroup: null,
      level: 0,
      sourceFieldIds: [fieldId],
      targetFieldIds: [fieldId],
      sourceFieldCount: 1,
      targetFieldCount: 1,
    });
    if (field.conditional) {
      riskFlags.add('conditional-target-backfill');
    }
  }

  return { paths, riskFlags: uniqueSorted(riskFlags) };
};

type StepAccumulator = {
  readonly level: number;
  readonly tableId: string;
  readonly fieldIds: Set<string>;
};

const buildPotentialSteps = (input: {
  readonly fieldsById: ReadonlyMap<string, IndexedField>;
  readonly reachable: ReadonlySet<string>;
  readonly levels: ReadonlyMap<string, number>;
  readonly blockedFieldIds: ReadonlySet<string>;
  readonly limit: number;
  readonly zeroLevelComputedFieldIds: ReadonlySet<string>;
}): {
  readonly steps: ReadonlyArray<OperationPotentialStep>;
  readonly potentialStepCount: number;
  readonly potentialFieldCount: number;
  readonly potentialLevelCount: number;
} => {
  const groups = new Map<string, StepAccumulator>();

  for (const fieldId of uniqueSorted(input.reachable)) {
    const field = input.fieldsById.get(fieldId);
    if (field === undefined || !field.isComputed) continue;
    const zeroLevel = input.zeroLevelComputedFieldIds.has(fieldId);
    if (input.blockedFieldIds.has(fieldId)) continue;
    const level = input.levels.get(fieldId);
    if (level === undefined || level > input.limit) continue;
    if (level === 0 && !zeroLevel) continue;

    const key = `${level}\u0000${field.tableId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.fieldIds.add(fieldId);
    } else {
      groups.set(key, { level, tableId: field.tableId, fieldIds: new Set([fieldId]) });
    }
  }

  const steps = [...groups.values()]
    .map((group) => ({
      tableId: group.tableId,
      level: group.level,
      fieldIds: uniqueSorted(group.fieldIds),
    }))
    .sort((left, right) => {
      const comparison = left.level - right.level;
      if (comparison !== 0) return comparison;
      return compareStrings(left.tableId, right.tableId);
    });

  const stepFieldIds = new Set<string>();
  const levels = new Set<number>();
  for (const step of steps) {
    levels.add(step.level);
    for (const fieldId of step.fieldIds) stepFieldIds.add(fieldId);
  }

  return {
    steps,
    potentialStepCount: steps.length,
    potentialFieldCount: stepFieldIds.size,
    potentialLevelCount: levels.size,
  };
};

const buildSuppressedPotentialShape = (
  completeness: SchemaCompleteness
): SchemaPotentialBuildResult => ({
  shape: {
    potentialSteps: [],
    potentialStepCount: 0,
    potentialFieldCount: 0,
    potentialLevelCount: 0,
    propagationPaths: [],
    propagationModeCounts: {
      sameRecord: 0,
      linkTraversal: 0,
      conditionalFiltered: 0,
      allTargetRecords: 0,
      backfill: 0,
    },
    blockedComputedFieldIds: [],
    truncatedFieldIds: [],
    truncated: completeness === 'truncated',
    riskFlags: [],
  },
  shapeRiskFlags: [],
});

const resolveSeedFieldIds = (input: {
  readonly operation: NormalizedOperation;
  readonly contextFreeFormulaFieldIds: ReadonlyArray<string>;
  readonly tableFieldIds: ReadonlyArray<string>;
  readonly tableComputedFieldIds: ReadonlyArray<string>;
}): Set<string> => {
  const seeds = new Set<string>(input.operation.changedFieldIds);
  if (isInsertLike(input.operation)) {
    for (const fieldId of input.tableFieldIds) seeds.add(fieldId);
  } else if (includesContextFreeSeeds(input.operation)) {
    for (const fieldId of input.contextFreeFormulaFieldIds) seeds.add(fieldId);
  }
  return seeds;
};

const resolveZeroLevelComputedFieldIds = (input: {
  readonly operation: NormalizedOperation;
  readonly contextFreeFormulaFieldIds: ReadonlyArray<string>;
  readonly tableComputedFieldIds: ReadonlyArray<string>;
  readonly backfillChange: 'create' | 'update' | 'convert' | null;
  readonly fieldsById: ReadonlyMap<string, IndexedField>;
}): Set<string> => {
  const ids = new Set<string>();
  if (isInsertLike(input.operation)) {
    for (const fieldId of input.tableComputedFieldIds) ids.add(fieldId);
  } else if (includesContextFreeSeeds(input.operation)) {
    for (const fieldId of input.contextFreeFormulaFieldIds) {
      if (input.fieldsById.get(fieldId)?.isComputed === true) ids.add(fieldId);
    }
  }
  if (input.backfillChange !== null) {
    for (const fieldId of input.operation.changedFieldIds) {
      if (input.fieldsById.get(fieldId)?.isComputed === true) ids.add(fieldId);
    }
  }
  return ids;
};

const resolveBlockedReachable = (
  reachable: ReadonlySet<string>,
  structural: StructuralComplexityProfile
): Set<string> => {
  const cyclicFieldIds = new Set(structural.cycleFieldIds);
  const blockedFieldIds = new Set(structural.blockedFieldIds);
  return new Set(
    [...reachable].filter((fieldId) => cyclicFieldIds.has(fieldId) || blockedFieldIds.has(fieldId))
  );
};

const buildSchemaPotentialShape = (input: {
  readonly model: SchemaModel;
  readonly structural: StructuralComplexityProfile;
  readonly operation: NormalizedOperation;
  readonly completeness: SchemaCompleteness;
  readonly bound: NormalizedBound;
  readonly contextFreeFormulaFieldIds: ReadonlyArray<string>;
}): SchemaPotentialBuildResult => {
  const { model, structural, operation } = input;
  const suppressed =
    operation.kind === 'delete' ||
    (operation.kind === 'field-change' && operation.fieldChange === 'delete');
  if (suppressed) return buildSuppressedPotentialShape(input.completeness);

  const backfillChange =
    operation.kind === 'field-change' &&
    (operation.fieldChange === 'create' ||
      operation.fieldChange === 'update' ||
      operation.fieldChange === 'convert')
      ? operation.fieldChange
      : null;
  const tableFieldIds = findTableFieldIds(model.fieldsById, operation.tableId);
  const tableComputedFieldIds = findTableComputedFieldIds(model.fieldsById, operation.tableId);
  const reachable = collectReachable(
    resolveSeedFieldIds({
      operation,
      contextFreeFormulaFieldIds: input.contextFreeFormulaFieldIds,
      tableFieldIds,
      tableComputedFieldIds,
    }),
    model.adjacency
  );
  const blockedReachable = resolveBlockedReachable(reachable, structural);
  const levels = computeLevels(reachable, blockedReachable, model.adjacency);

  const steps = buildPotentialSteps({
    fieldsById: model.fieldsById,
    reachable,
    levels,
    blockedFieldIds: blockedReachable,
    limit: input.bound.limit,
    zeroLevelComputedFieldIds: resolveZeroLevelComputedFieldIds({
      operation,
      contextFreeFormulaFieldIds: input.contextFreeFormulaFieldIds,
      tableComputedFieldIds,
      backfillChange,
      fieldsById: model.fieldsById,
    }),
  });

  const propagation = buildSchemaPropagationPaths({
    edges: model.edges,
    reachable,
    blockedReachable,
    levels,
    limit: input.bound.limit,
    changedFieldIds: new Set(operation.changedFieldIds),
    backfillChange,
    beforeImage: operation.beforeImage,
  });
  const selfBackfill = buildSelfBackfillPaths({
    operation,
    backfillChange,
    fieldsById: model.fieldsById,
    blockedFieldIds: blockedReachable,
  });
  const propagationPaths = mergePropagationPaths([propagation.paths, selfBackfill.paths]);

  const truncatedFieldIds = uniqueSorted(
    [...reachable].filter((fieldId) => {
      const level = levels.get(fieldId);
      return level !== undefined && level > input.bound.limit;
    })
  );
  const blockedComputedFieldIds = uniqueSorted(
    [...blockedReachable].filter((fieldId) => model.fieldsById.get(fieldId)?.isComputed === true)
  );

  const shapeRiskFlags = new Set<OperationRiskFlag>([
    ...propagation.riskFlags,
    ...selfBackfill.riskFlags,
  ]);
  if (blockedReachable.size > 0) shapeRiskFlags.add('dependency-cycle');
  if (truncatedFieldIds.length > 0) shapeRiskFlags.add('traversal-truncated');

  return {
    shape: {
      potentialSteps: steps.steps,
      potentialStepCount: steps.potentialStepCount,
      potentialFieldCount: steps.potentialFieldCount,
      potentialLevelCount: steps.potentialLevelCount,
      propagationPaths,
      propagationModeCounts: countPropagationModes(propagationPaths),
      blockedComputedFieldIds,
      truncatedFieldIds,
      truncated: truncatedFieldIds.length > 0 || input.completeness === 'truncated',
      riskFlags: uniqueSorted(shapeRiskFlags),
    },
    shapeRiskFlags: uniqueSorted(shapeRiskFlags),
  };
};

// ---------------------------------------------------------------------------
// Planner shape
// ---------------------------------------------------------------------------

const buildPlannerShape = (plan: NormalizedPlannerPlan): PlannerOperationShape => {
  const pathLevels = new Map<string, number>();
  for (const step of plan.steps) {
    for (const fieldId of step.fieldIds) pathLevels.set(fieldId, step.level);
  }
  const propagationPaths: OperationPropagationPath[] = plan.paths.map((path) => ({
    fromFieldId: path.fromFieldId,
    toFieldId: path.toFieldId,
    fromTableId: path.fromTableId,
    toTableId: path.toTableId,
    mode: path.mode,
    origin: path.origin ?? 'dependency',
    certainty: 'structural' as const,
    linkFieldId: path.linkFieldId ?? null,
    beforeImage:
      path.beforeImage ??
      (path.mode === 'conditionalFiltered'
        ? plan.beforeImage === 'available'
          ? 'included'
          : 'unknown'
        : 'not-required'),
    alternativeGroup: path.alternativeGroup ?? null,
    level: path.level ?? pathLevels.get(path.toFieldId) ?? 0,
    ...(path.reason === undefined ? {} : { reason: path.reason }),
    ...(path.sourceFieldIds === undefined ? {} : { sourceFieldIds: path.sourceFieldIds }),
    ...(path.targetFieldIds === undefined ? {} : { targetFieldIds: path.targetFieldIds }),
    ...(path.sourceFieldCount === undefined ? {} : { sourceFieldCount: path.sourceFieldCount }),
    ...(path.targetFieldCount === undefined ? {} : { targetFieldCount: path.targetFieldCount }),
  }));

  const stepFieldIds = new Set<string>();
  const levels = new Set<number>();
  for (const step of plan.steps) {
    levels.add(step.level);
    for (const fieldId of step.fieldIds) stepFieldIds.add(fieldId);
  }

  const riskFlags = new Set<OperationRiskFlag>();
  if (plan.cycle) riskFlags.add('dependency-cycle');
  if (plan.truncated) riskFlags.add('planner-shape-truncated');
  if (!plan.beforeImageProvided) riskFlags.add('planner-before-image-missing');
  if (plan.seedAllTableIds.length > 0) riskFlags.add('planner-seed-all-tables');

  const hasConditionalPath = propagationPaths.some(
    (path) => path.mode === 'conditionalFiltered' || path.mode === 'allTargetRecords'
  );
  if (hasConditionalPath && plan.beforeImage !== 'available') {
    riskFlags.add('conditional-before-image-unknown');
  }
  if (propagationPaths.some((path) => path.mode === 'allTargetRecords')) {
    riskFlags.add('conditional-all-target-possible');
  }

  return {
    source: 'planner',
    steps: plan.steps,
    potentialStepCount: plan.steps.length,
    potentialFieldCount: stepFieldIds.size,
    potentialLevelCount: levels.size,
    propagationPaths,
    propagationModeCounts: countPropagationModes(propagationPaths),
    seedAllTableIds: plan.seedAllTableIds,
    cycle: plan.cycle,
    truncated: plan.truncated,
    beforeImage: plan.beforeImage,
    riskFlags: uniqueSorted(riskFlags),
  };
};

// ---------------------------------------------------------------------------
// Operation profile assembly
// ---------------------------------------------------------------------------

const buildSchemaStateRiskFlags = (input: {
  readonly model: SchemaModel;
  readonly operation: NormalizedOperation;
  readonly completeness: SchemaCompleteness;
  readonly bound: NormalizedBound;
}): ReadonlyArray<OperationRiskFlag> => {
  const { model, operation, completeness, bound } = input;
  const riskFlags = new Set<OperationRiskFlag>();

  if (completeness === 'partial') riskFlags.add('schema-partial');
  if (completeness === 'truncated') riskFlags.add('schema-truncated');
  if (model.unresolvedFieldIds.length > 0) riskFlags.add('unresolved-field-metadata');
  if (!model.tableIds.has(operation.tableId)) riskFlags.add('unknown-operation-table');
  if (operation.changedFieldIds.some((fieldId) => !model.fieldsById.has(fieldId))) {
    riskFlags.add('unknown-changed-field');
  }
  if (bound.invalid) riskFlags.add('invalid-max-traversal-depth');

  return uniqueSorted(riskFlags);
};

const buildOperationSemanticsRiskFlags = (input: {
  readonly operation: NormalizedOperation;
}): ReadonlyArray<OperationRiskFlag> => {
  const { operation } = input;
  const riskFlags = new Set<OperationRiskFlag>();

  if (
    operation.changedFieldIds.length === 0 &&
    (operation.kind === 'update' || operation.kind === 'paste' || operation.kind === 'field-change')
  ) {
    riskFlags.add('empty-changed-fields');
  }
  if (operation.kind === 'field-change' && operation.fieldChange === null) {
    riskFlags.add('field-change-without-field-change');
  }
  if (operation.kind === 'delete') {
    riskFlags.add('record-delete-schema-potential-unavailable');
  }
  if (operation.kind === 'field-change' && operation.fieldChange === 'delete') {
    riskFlags.add('field-delete-no-backfill');
    riskFlags.add('field-delete-work-unknown');
  }

  return uniqueSorted(riskFlags);
};

const buildCommonRiskFlags = (input: {
  readonly model: SchemaModel;
  readonly operation: NormalizedOperation;
  readonly completeness: SchemaCompleteness;
  readonly bound: NormalizedBound;
  readonly contextFreeFormulaFieldIds: ReadonlyArray<string>;
}): ReadonlyArray<OperationRiskFlag> =>
  uniqueSorted([...buildSchemaStateRiskFlags(input), ...buildOperationSemanticsRiskFlags(input)]);

const buildOperationWarnings = (input: {
  readonly model: SchemaModel;
  readonly operation: NormalizedOperation;
  readonly bound: NormalizedBound;
  readonly maxTraversalDepth: number | undefined;
}): ReadonlyArray<string> => {
  const warnings = new Set<string>();
  for (const fieldId of input.operation.changedFieldIds) {
    if (!input.model.fieldsById.has(fieldId)) {
      warnings.add(`unknown-changed-field:${fieldId}`);
    }
  }
  if (!input.model.tableIds.has(input.operation.tableId)) {
    warnings.add(`unknown-operation-table:${input.operation.tableId}`);
  }
  if (input.bound.invalid) {
    warnings.add(`invalid-max-traversal-depth:${String(input.maxTraversalDepth)}`);
  }
  if (input.operation.kind === 'field-change' && input.operation.fieldChange === null) {
    warnings.add('field-change-without-field-change');
  }
  return uniqueSorted(warnings);
};

const buildOperationProfile = (input: {
  readonly model: SchemaModel;
  readonly structural: StructuralComplexityProfile;
  readonly operation: NormalizedOperation;
  readonly completeness: SchemaCompleteness;
  readonly bound: NormalizedBound;
  readonly maxTraversalDepth: number | undefined;
}): OperationBuildResult => {
  const contextFreeFormulaFieldIds = findContextFreeFormulaFieldIds(
    input.model.fieldsById,
    input.operation.tableId
  );

  const commonRiskFlags = buildCommonRiskFlags({
    model: input.model,
    operation: input.operation,
    completeness: input.completeness,
    bound: input.bound,
    contextFreeFormulaFieldIds,
  });

  const schemaPotentialBuild = buildSchemaPotentialShape({
    model: input.model,
    structural: input.structural,
    operation: input.operation,
    completeness: input.completeness,
    bound: input.bound,
    contextFreeFormulaFieldIds,
  });

  const schemaPotential: SchemaPotentialOperationShape = {
    ...schemaPotentialBuild.shape,
    riskFlags: uniqueSorted([...commonRiskFlags, ...schemaPotentialBuild.shapeRiskFlags]),
  };

  const plannerShape =
    input.operation.plan === null ? null : buildPlannerShape(input.operation.plan);
  const shapeRiskFlags = plannerShape
    ? plannerShape.riskFlags
    : schemaPotentialBuild.shapeRiskFlags;
  const riskFlags = uniqueSorted([...commonRiskFlags, ...shapeRiskFlags]);
  const effectiveShapeSource: 'schema-potential' | 'planner' = plannerShape
    ? 'planner'
    : 'schema-potential';

  return {
    operation: {
      kind: input.operation.kind,
      tableId: input.operation.tableId,
      fieldChange: input.operation.fieldChange,
      pasteMode: input.operation.pasteMode,
      shapeSource: 'schema-potential',
      effectiveShapeSource,
      uncertainty: plannerShape
        ? 'known'
        : input.operation.kind === 'delete' ||
            (input.operation.kind === 'field-change' &&
              input.operation.fieldChange === 'delete')
          ? 'unknown'
          : 'known',
      changedFieldIds: input.operation.changedFieldIds,
      contextFreeFormulaFieldIds,
      schemaPotential,
      plannerShape,
      propagationModeCounts: plannerShape
        ? plannerShape.propagationModeCounts
        : schemaPotential.propagationModeCounts,
      riskFlags,
      truncated: plannerShape ? plannerShape.truncated : schemaPotential.truncated,
    },
    warnings: buildOperationWarnings({
      model: input.model,
      operation: input.operation,
      bound: input.bound,
      maxTraversalDepth: input.maxTraversalDepth,
    }),
  };
};

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

const buildFormulaEntries = (
  fieldsById: ReadonlyMap<string, IndexedField>
): ReadonlyArray<FormulaComplexityEntry> => {
  const entries: FormulaComplexityEntry[] = [];
  for (const field of fieldsById.values()) {
    if (field.formula !== undefined) {
      entries.push({ fieldId: field.id, tableId: field.tableId, profile: field.formula });
    }
  }
  return entries.sort((left, right) => {
    const comparison = compareStrings(left.tableId, right.tableId);
    if (comparison !== 0) return comparison;
    return compareStrings(left.fieldId, right.fieldId);
  });
};

/**
 * Build the structural portion of the profile.
 *
 * All supplied edges are used. Fields referenced by an edge but absent from
 * `fields` are reported through `unresolvedFieldIds`; they still participate
 * in topology, cycle detection, and depth.
 */
export const buildStructuralProfile = (
  input: StructuralProfileInput
): StructuralComplexityProfile => {
  const model = prepareModel(input);
  return buildStructuralFromModel(
    model,
    normalizeCompleteness(input.completeness),
    input.focusTableId ?? null
  );
};

/**
 * Build the operation shape.
 *
 * Returns `null` only when the operation descriptor is unusable at runtime
 * (for example an unrecognized `kind`).
 */
export const buildOperationShape = (
  input: OperationShapeInput
): SchemaOperationShapeProfile | null => {
  const model = prepareModel(input);
  const completeness = normalizeCompleteness(input.completeness);
  const structural = buildStructuralFromModel(model, completeness, null);
  const normalization = normalizeOperation(input.operation);
  if (normalization.operation === null) return null;

  return buildOperationProfile({
    model,
    structural,
    operation: normalization.operation,
    completeness,
    bound: normalizeBound(input.maxTraversalDepth),
    maxTraversalDepth: input.maxTraversalDepth,
  }).operation;
};

/**
 * Build the complete schema-only complexity profile.
 *
 * The operation shape is deterministic from the supplied schema and operation
 * descriptor. A supplied plan is preserved verbatim in `operation.plannerShape`
 * and does not alter `operation.schemaPotential`.
 */
export const buildSchemaComplexityProfile = (
  input: SchemaComplexityProfileInput
): SchemaComplexityProfile => {
  const focusTableId = input.focusTableId ?? null;
  const completeness = normalizeCompleteness(input.completeness);
  const model = prepareModel(input);
  const structural = buildStructuralFromModel(model, completeness, focusTableId);

  const normalization = normalizeOperation(input.operation);
  const bound = normalizeBound(input.maxTraversalDepth);

  const operationResult =
    normalization.operation === null
      ? null
      : buildOperationProfile({
          model,
          structural,
          operation: normalization.operation,
          completeness,
          bound,
          maxTraversalDepth: input.maxTraversalDepth,
        });

  const warnings = new Set<string>(model.warnings);
  for (const warning of normalization.warnings) warnings.add(warning);
  for (const warning of operationResult?.warnings ?? []) warnings.add(warning);
  if (focusTableId !== null && !model.tableIds.has(focusTableId)) {
    warnings.add(`unknown-focus-table:${focusTableId}`);
  }

  const operation = operationResult?.operation ?? null;
  const beforeImage =
    input.operation?.beforeImage !== undefined
      ? (normalization.operation?.beforeImage ?? null)
      : (normalization.operation?.plan?.beforeImage ?? null);

  return {
    version: SCHEMA_COMPLEXITY_PROFILE_VERSION,
    basis: SCHEMA_COMPLEXITY_BASIS,
    scope: { focusTableId },
    structural,
    formulas: buildFormulaEntries(model.fieldsById),
    operation,
    evidence: {
      completeness,
      dataPresence: normalization.operation?.dataPresence ?? 'unknown',
      beforeImage,
    },
    warnings: uniqueSorted(warnings),
  };
};
