import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  TableRecordQueryBuilderManager,
  v2RecordRepositoryPostgresTokens,
} from '@teable/v2-adapter-table-repository-postgres';
import { registerV2TableOpsPostgresAdapter } from '@teable/v2-adapter-table-query-ops-postgres';
import {
  ActorId,
  buildRecordConditionSpec,
  FieldId,
  FieldType,
  sanitizeRecordFilter,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type Field,
  type FormulaField,
  type ICommandBus,
  type IExecutionContext,
  type ITableRepository,
  type ITracer,
  type Table,
} from '@teable/v2-core';
import {
  FormulaSqlPgTranslator,
  makeExpr,
  Pg16TypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
import {
  AnalyzeAndRecommendTableQueryCommand,
  type AnalyzeAndRecommendTableQueryResult,
  buildSavedViewConfigObservation,
  planRecommendedIndexSet,
  RecordTableQueryObservationCommand,
  registerV2TableOps,
  RunTableQueryRecommendedIndexCommand,
  TableQueryObservationWindow,
  TableQueryShape,
  type ExecutablePhase1RemediationKind,
  type IndexSetPlannerCandidate,
  type TableQueryObservationWindowInput,
  type TableQueryRemediationTask,
} from '@teable/v2-table-query-ops';
import { Effect, Layer } from 'effect';
import { CompiledQuery, sql, type Kysely } from 'kysely';
import { ok } from 'neverthrow';
import { CliError } from '../errors';
import { Database } from '../services/Database';
import {
  TableQueryOps,
  type TableQueryOpsAnalyzeObservationInput,
  type TableQueryOpsAnalyzeObservationResult,
  type TableQueryOpsAnalyzeSavedViewsInput,
  type TableQueryOpsAnalyzeSavedViewsResult,
  type TableQueryOpsExecuteRecommendationsInput,
  type TableQueryOpsExecuteRecommendationsResult,
  type TableQueryOpsExplainSavedViewsInput,
  type TableQueryOpsExplainSavedViewsResult,
  type TableQueryOpsFormulaEvidenceSummary,
  type TableQueryOpsCoverageReportSummary,
  type TableQueryOpsIndexCandidateSummary,
  type TableQueryOpsIndexFieldSummary,
  type TableQueryOpsIndexPlanSummary,
  type TableQueryOpsQueryRiskReportSummary,
  type TableQueryOpsRejectedIndexCandidateSummary,
  type TableQueryOpsSavedViewAnalysis,
  type TableQueryOpsSourceCoverageStatus,
  type TableQueryOpsSourceCoverageSummary,
  type TableQueryOpsOverviewInput,
  type TableQueryOpsOverviewResult,
  type TableQueryOpsPlanEvidenceSummary,
  type TableQueryOpsRecommendedIndexSetSummary,
  type TableQueryOpsRecommendedIndexSummary,
  type TableQueryOpsScopeInput,
} from '../services/TableQueryOps';

type UnknownRow = Record<string, unknown>;

type SavedViewRow = {
  readonly view_id: string;
  readonly space_id: string | null;
  readonly base_id: string;
  readonly table_id: string;
  readonly filter: string | null;
  readonly sort: string | null;
  readonly group: string | null;
  readonly last_modified_time: Date | string | null;
};

type CountRow = {
  readonly count?: number | string | bigint | null;
  readonly observation_window_count?: number | string | bigint | null;
  readonly request_count?: number | string | bigint | null;
  readonly slow_count?: number | string | bigint | null;
  readonly timeout_count?: number | string | bigint | null;
  readonly db_error_count?: number | string | bigint | null;
  readonly recommendation_count?: number | string | bigint | null;
  readonly open_recommendation_count?: number | string | bigint | null;
  readonly accepted_recommendation_count?: number | string | bigint | null;
  readonly task_count?: number | string | bigint | null;
  readonly running_task_count?: number | string | bigint | null;
  readonly failed_task_count?: number | string | bigint | null;
};

type HotTableRow = {
  readonly space_id: string | null;
  readonly base_id: string;
  readonly table_id: string;
  readonly request_count: number | string | bigint | null;
  readonly slow_count: number | string | bigint | null;
  readonly timeout_count: number | string | bigint | null;
  readonly db_error_count: number | string | bigint | null;
  readonly max_duration_ms: number | string | null;
  readonly latest_window_start: Date | string | null;
};

type RecommendationRow = {
  readonly id: string;
  readonly space_id: string | null;
  readonly base_id: string;
  readonly table_id: string;
  readonly shape_hash: string;
  readonly policy_version: string;
  readonly status: string;
  readonly risk_level: string;
  readonly risk_score: number;
  readonly reason_codes: unknown;
  readonly remediation_candidates: unknown;
  readonly snapshot: unknown;
  readonly created_time: Date | string | null;
  readonly last_modified_time: Date | string | null;
};

type TaskRow = {
  readonly id: string;
  readonly recommendation_id: string | null;
  readonly base_id: string;
  readonly table_id: string;
  readonly kind: string;
  readonly status: string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly last_error: string | null;
  readonly created_time: Date | string | null;
  readonly last_modified_time: Date | string | null;
};

type TableOpsRegistration = {
  registeredCore: boolean;
  schemaEnsured: boolean;
};

type ExplainPlan = {
  readonly startupCost?: number;
  readonly totalCost?: number;
  readonly nodeType?: string;
  readonly indexName?: string;
  readonly rawPlan?: unknown;
};

type ExplainRow = {
  readonly 'QUERY PLAN': unknown;
};

type CompiledSql = {
  readonly sql: string;
  readonly parameters: readonly unknown[];
};

const MIN_RECOMMENDED_COST_IMPROVEMENT_PCT = 20;

const toNumber = (value: unknown): number => {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return 0;
};

const toIsoString = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const getRemediationKinds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((candidate) =>
      candidate && typeof candidate === 'object' && 'kind' in candidate
        ? (candidate as { kind?: unknown }).kind
        : undefined
    )
    .filter((kind): kind is string => typeof kind === 'string');
};

const getQueryKind = (snapshot: unknown): string | undefined => {
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  const observation = (snapshot as { observation?: unknown }).observation;
  if (!observation || typeof observation !== 'object') return undefined;
  const shape = (observation as { shape?: unknown }).shape;
  if (!shape || typeof shape !== 'object') return undefined;
  const queryKind = (shape as { queryKind?: unknown }).queryKind;
  return typeof queryKind === 'string' ? queryKind : undefined;
};

const getErrorDetails = (error: unknown): unknown => {
  if (!error || typeof error !== 'object') return undefined;
  const details = (error as { details?: unknown }).details;
  return details == null ? undefined : details;
};

const formatIndexStructure = (input: {
  readonly fieldId?: string;
  readonly fieldDbName?: string;
  readonly fields?: ReadonlyArray<{
    readonly fieldId?: string;
    readonly fieldDbName?: string;
    readonly direction?: 'asc' | 'desc';
    readonly role?: string;
  }>;
  readonly kind: string;
  readonly accessPath?: string;
  readonly valid?: boolean;
  readonly reason?: string;
  readonly name?: string;
}): string => {
  const fields =
    input.fields && input.fields.length > 0
      ? input.fields.map((field) => {
          const label = field.fieldId ?? field.fieldDbName ?? '<unknown-field>';
          const dbName =
            field.fieldDbName && field.fieldDbName !== field.fieldId
              ? ` (${field.fieldDbName})`
              : '';
          const direction = field.direction ? ` ${field.direction.toUpperCase()}` : '';
          const role = field.role ? `:${field.role}` : '';
          return `${label}${dbName}${direction}${role}`;
        })
      : [
          `${input.fieldId ?? input.fieldDbName ?? '<unknown-field>'}${
            input.fieldDbName && input.fieldDbName !== input.fieldId
              ? ` (${input.fieldDbName})`
              : ''
          }`,
        ];
  const method = input.kind === 'gin_trgm' ? 'GIN gin_trgm_ops' : 'BTREE';
  const accessPath = input.accessPath === 'composite' ? ' composite' : '';
  const status = input.valid === false ? ' invalid' : '';
  const name = input.name ? ` name=${input.name}` : '';
  const reason = input.reason ? ` reason=${input.reason}` : '';
  return `${method}${accessPath} on ${fields.join(', ')}${status}${name}${reason}`;
};

const normalizeIndexFields = (input: {
  readonly fieldId?: string;
  readonly fieldDbName?: string;
  readonly fields?: ReadonlyArray<TableQueryOpsIndexFieldSummary>;
}): TableQueryOpsIndexCandidateSummary['fields'] => {
  if (input.fields && input.fields.length > 0) {
    return input.fields.map((field) => ({
      ...(field.fieldId ? { fieldId: field.fieldId } : {}),
      ...(field.fieldDbName ? { fieldDbName: field.fieldDbName } : {}),
      ...(field.direction ? { direction: field.direction } : {}),
      ...(field.role ? { role: field.role } : {}),
      ...(field.sourceKind ? { sourceKind: field.sourceKind } : {}),
      ...(field.formulaFieldId ? { formulaFieldId: field.formulaFieldId } : {}),
      ...(field.formulaFunctionNames ? { formulaFunctionNames: field.formulaFunctionNames } : {}),
      ...(field.formulaSkippedReasons
        ? { formulaSkippedReasons: field.formulaSkippedReasons }
        : {}),
      ...(field.formulaPredicatePushdown
        ? { formulaPredicatePushdown: field.formulaPredicatePushdown }
        : {}),
    }));
  }
  return [
    {
      ...(input.fieldId ? { fieldId: input.fieldId } : {}),
      ...(input.fieldDbName ? { fieldDbName: input.fieldDbName } : {}),
    },
  ].filter((field) => field.fieldId || field.fieldDbName);
};

const formatOptimizedField = (
  field: TableQueryOpsIndexCandidateSummary['fields'][number]
): string => {
  const label = field.fieldId ?? field.fieldDbName ?? '<unknown-field>';
  const dbName =
    field.fieldDbName && field.fieldDbName !== field.fieldId ? ` (${field.fieldDbName})` : '';
  const direction = field.direction ? ` ${field.direction.toUpperCase()}` : '';
  const role = field.role ? `:${field.role}` : '';
  return `${label}${dbName}${direction}${role}`;
};

const buildIndexKey = (input: {
  readonly kind: string;
  readonly accessPath?: string;
  readonly fieldId?: string;
  readonly fieldDbName?: string;
  readonly fields?: ReadonlyArray<TableQueryOpsIndexFieldSummary>;
}): string => {
  const fields = normalizeIndexFields(input)
    .map(
      (field) =>
        `${field.fieldDbName ?? field.fieldId}:${field.direction ?? ''}:${field.role ?? ''}`
    )
    .join('|');
  return `${input.kind}:${input.accessPath ?? 'single_field'}:${fields}`;
};

const buildIndexCandidateSummary = (input: {
  readonly fieldId?: string;
  readonly fieldDbName?: string;
  readonly fields?: ReadonlyArray<TableQueryOpsIndexFieldSummary>;
  readonly kind: string;
  readonly accessPath?: string;
  readonly reason: string;
}): TableQueryOpsIndexCandidateSummary => {
  const fields = normalizeIndexFields(input);
  return {
    indexKey: buildIndexKey(input),
    indexKind: input.kind,
    accessPath: input.accessPath ?? 'single_field',
    indexStructure: formatIndexStructure(input),
    fields,
    reason: input.reason,
  };
};

const uniqueFormulaEvidence = (values: readonly TableQueryOpsFormulaEvidenceSummary[]) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

type TableQueryRiskReportSnapshot = ReturnType<
  AnalyzeAndRecommendTableQueryResult['report']['snapshot']
>;
type TableQueryShapeSnapshot = TableQueryRiskReportSnapshot['observation']['shape'];

const formulaEvidenceFromShapeFormula = (
  formula: NonNullable<
    NonNullable<TableQueryShapeSnapshot['whereShape']>['fields'][number]['formula']
  >
): TableQueryOpsFormulaEvidenceSummary => ({
  formulaFieldId: formula.formulaFieldId,
  referencedFieldIds: [...formula.referencedFieldIds],
  functionNames: [...formula.functionNames],
  sourceKind: formula.sourceKind,
  skippedReasons: [...formula.skippedReasons],
  expressionIndexable: formula.expressionIndexable ?? false,
  expressionIndexSkippedReasons: [...(formula.expressionIndexSkippedReasons ?? [])],
  ...(formula.predicatePushdown
    ? {
        predicatePushdown: {
          supported: formula.predicatePushdown.supported,
          operatorFamilies: [...formula.predicatePushdown.operatorFamilies],
          sourceFunctionNames: [...formula.predicatePushdown.sourceFunctionNames],
          skippedReasons: [...formula.predicatePushdown.skippedReasons],
        },
      }
    : {}),
});

const buildShapeSummary = (
  shape: TableQueryShapeSnapshot
): TableQueryOpsQueryRiskReportSummary['shapeSummary'] => ({
  filterFields:
    shape.whereShape?.fields.map((field) => ({
      fieldId: field.fieldId,
      operatorFamily: field.operatorFamily,
      ...(field.sourceKind ? { sourceKind: field.sourceKind } : {}),
    })) ?? [],
  sortFields:
    shape.orderShape?.fields.map((field) => ({
      ...(field.fieldId ? { fieldId: field.fieldId } : {}),
      ...(field.systemColumn ? { systemColumn: field.systemColumn } : {}),
      direction: field.direction,
      source: field.source,
    })) ?? [],
  ...(shape.searchShape
    ? {
        search: {
          fieldCount: shape.searchShape.fieldCount,
          allFields: shape.searchShape.allFields,
          valueLengthBucket: shape.searchShape.valueLengthBucket,
        },
      }
    : {}),
  ...(shape.aggregationShape
    ? {
        aggregation: {
          groupFieldCount: shape.aggregationShape.groupFieldCount,
          metricCount: shape.aggregationShape.metricCount,
          hasFilter: shape.aggregationShape.hasFilter,
        },
      }
    : {}),
  ...(shape.relationShape
    ? {
        relation: {
          relationKind: shape.relationShape.relationKind,
          sourceTableId: shape.relationShape.sourceTableId,
          targetTableId: shape.relationShape.targetTableId,
          fieldReferenceCount: shape.relationShape.fieldReferenceCount,
          hasTargetFilter: shape.relationShape.hasTargetFilter,
          hasTargetSort: shape.relationShape.hasTargetSort,
        },
      }
    : {}),
  formulaFields: uniqueFormulaEvidence(
    shape.whereShape?.fields.flatMap((field) =>
      field.formula ? [formulaEvidenceFromShapeFormula(field.formula)] : []
    ) ?? []
  ),
});

const buildIndexPlanSummary = (input: {
  readonly viewId?: string;
  readonly queryKind: string;
  readonly shapeHash: string;
  readonly report: AnalyzeAndRecommendTableQueryResult['report'];
}): TableQueryOpsIndexPlanSummary => {
  const snapshot = input.report.snapshot();
  const inspection = snapshot.indexInspection;
  const planValidation = snapshot.planValidation;
  const explainCostDelta =
    typeof planValidation?.totalCostBefore === 'number' &&
    typeof planValidation.totalCostAfter === 'number'
      ? planValidation.totalCostAfter - planValidation.totalCostBefore
      : undefined;
  const explainCostDeltaPct =
    typeof explainCostDelta === 'number' &&
    typeof planValidation?.totalCostBefore === 'number' &&
    planValidation.totalCostBefore > 0
      ? (explainCostDelta / planValidation.totalCostBefore) * 100
      : undefined;
  const candidateIndexStructures = inspection.missingIndexCandidates.map(formatIndexStructure);
  const candidateIndexes = inspection.missingIndexCandidates.map(buildIndexCandidateSummary);
  const abnormalIndexes = inspection.abnormalIndexes.map((item) => `${item.name}: ${item.reason}`);
  const remediationKinds = snapshot.remediationCandidates.map((item) => item.kind);
  const nextAction =
    candidateIndexStructures.length > 0
      ? 'review_or_accept_candidate_index'
      : abnormalIndexes.length > 0
        ? 'repair_abnormal_index'
        : remediationKinds.includes('manual_investigation')
          ? 'manual_investigation'
          : 'no_index_change';

  return {
    ...(input.viewId ? { viewId: input.viewId } : {}),
    queryKind: input.queryKind,
    shapeHash: input.shapeHash,
    riskLevel: snapshot.level,
    riskScore: snapshot.score,
    reasonCodes: snapshot.reasonCodes,
    candidateIndexes,
    shapeSummary: buildShapeSummary(snapshot.observation.shape),
    physicalStats: { estimatedRows: snapshot.physicalStats.estimatedRows },
    indexState: inspection.state,
    existingIndexStructures: inspection.usefulIndexes.map(formatIndexStructure),
    candidateIndexStructures,
    abnormalIndexes,
    explainStatus: planValidation?.status,
    explainMethod: planValidation?.method,
    explainReason: planValidation?.reason,
    explainCostBefore: planValidation?.totalCostBefore,
    explainCostAfter: planValidation?.totalCostAfter,
    explainCostDelta,
    explainCostDeltaPct:
      typeof explainCostDeltaPct === 'number' ? Number(explainCostDeltaPct.toFixed(2)) : undefined,
    explainPlanNodeBefore: planValidation?.planNodeBefore,
    explainPlanNodeAfter: planValidation?.planNodeAfter,
    explainUsesCandidateIndex: planValidation?.usesCandidateIndex,
    hypotheticalIndexStatements: planValidation?.indexStatements ?? [],
    nextAction,
  };
};

const buildPlanEvidence = (
  source: string,
  plan: TableQueryOpsIndexPlanSummary
): TableQueryOpsPlanEvidenceSummary => ({
  source,
  queryKind: plan.queryKind,
  shapeHash: plan.shapeHash,
  riskLevel: plan.riskLevel,
  riskScore: plan.riskScore,
  reasonCodes: plan.reasonCodes,
  explainStatus: plan.explainStatus,
  explainMethod: plan.explainMethod,
  explainReason: plan.explainReason,
  explainCostBefore: plan.explainCostBefore,
  explainCostAfter: plan.explainCostAfter,
  explainCostDelta: plan.explainCostDelta,
  explainCostDeltaPct: plan.explainCostDeltaPct,
  explainPlanNodeBefore: plan.explainPlanNodeBefore,
  explainPlanNodeAfter: plan.explainPlanNodeAfter,
  explainUsesCandidateIndex: plan.explainUsesCandidateIndex,
  hypotheticalIndexStatements: plan.hypotheticalIndexStatements,
});

const unique = (values: Iterable<string | undefined>): readonly string[] => [
  ...new Set([...values].filter((value): value is string => Boolean(value))),
];

const formulaEvidenceFromFields = (fields: readonly TableQueryOpsIndexFieldSummary[]) => {
  const formulaFields = fields.filter((field) => field.sourceKind?.startsWith('formula_'));
  if (formulaFields.length === 0) return undefined;
  const formulaFieldId = formulaFields.find((field) => field.formulaFieldId)?.formulaFieldId;
  const sourceKind = formulaFields.find((field) => field.sourceKind)?.sourceKind as
    | 'formula_result'
    | 'formula_source'
    | 'formula_expression'
    | undefined;
  const predicatePushdown = formulaFields.find(
    (field) => field.formulaPredicatePushdown
  )?.formulaPredicatePushdown;
  return {
    ...(formulaFieldId ? { formulaFieldId } : {}),
    referencedFieldIds: unique(formulaFields.map((field) => field.fieldId)),
    functionNames: unique(formulaFields.flatMap((field) => field.formulaFunctionNames ?? [])),
    ...(sourceKind ? { sourceKind } : {}),
    skippedReasons: unique(formulaFields.flatMap((field) => field.formulaSkippedReasons ?? [])),
    ...(predicatePushdown
      ? {
          predicatePushdown: {
            supported: predicatePushdown.supported,
            operatorFamilies: [...predicatePushdown.operatorFamilies],
            sourceFunctionNames: [...predicatePushdown.sourceFunctionNames],
            skippedReasons: [...predicatePushdown.skippedReasons],
          },
        }
      : {}),
  };
};

const fieldIdentity = (
  field: TableQueryOpsIndexCandidateSummary['fields'][number] | undefined
): string | undefined => field?.fieldDbName ?? field?.fieldId;

const normalizeRecommendationCandidate = (
  candidate: TableQueryOpsIndexCandidateSummary
): TableQueryOpsIndexCandidateSummary => {
  if (
    candidate.indexKind !== 'btree' ||
    candidate.accessPath !== 'single_field' ||
    candidate.fields.length !== 1
  ) {
    return candidate;
  }
  const field = candidate.fields[0];
  const indexKey = `btree:single_field:${fieldIdentity(field) ?? candidate.indexKey}`;
  const normalizedField = {
    ...(field.fieldId ? { fieldId: field.fieldId } : {}),
    ...(field.fieldDbName ? { fieldDbName: field.fieldDbName } : {}),
    ...(field.role ? { role: field.role } : {}),
    ...(field.sourceKind ? { sourceKind: field.sourceKind } : {}),
    ...(field.formulaFieldId ? { formulaFieldId: field.formulaFieldId } : {}),
    ...(field.formulaFunctionNames ? { formulaFunctionNames: field.formulaFunctionNames } : {}),
    ...(field.formulaSkippedReasons ? { formulaSkippedReasons: field.formulaSkippedReasons } : {}),
    ...(field.formulaPredicatePushdown
      ? { formulaPredicatePushdown: field.formulaPredicatePushdown }
      : {}),
  };
  return {
    ...candidate,
    indexKey,
    indexStructure: `BTREE on ${formatOptimizedField(normalizedField)} reason=${candidate.reason}`,
    fields: [normalizedField],
  };
};

const confidenceFromEvidence = (evidence: readonly TableQueryOpsPlanEvidenceSummary[]): string => {
  if (
    evidence.some(
      (item) =>
        item.explainStatus === 'validated' &&
        item.explainUsesCandidateIndex === true &&
        typeof item.explainCostDelta === 'number' &&
        item.explainCostDelta < 0
    )
  ) {
    return 'high_plan_validated';
  }
  if (evidence.some((item) => item.explainStatus === 'validated')) return 'medium_plan_validated';
  if (evidence.some((item) => item.explainStatus === 'skipped')) return 'needs_plan_validation';
  return 'needs_review';
};

const buildRecommendedIndexes = (
  entries: ReadonlyArray<{
    readonly source: string;
    readonly indexPlan: TableQueryOpsIndexPlanSummary;
  }>
): readonly TableQueryOpsRecommendedIndexSummary[] => {
  const grouped = new Map<
    string,
    {
      readonly candidate: TableQueryOpsIndexCandidateSummary;
      readonly evidence: TableQueryOpsPlanEvidenceSummary[];
    }
  >();

  for (const entry of entries) {
    for (const rawCandidate of entry.indexPlan.candidateIndexes) {
      const candidate = normalizeRecommendationCandidate(rawCandidate);
      const existing = grouped.get(candidate.indexKey);
      const evidence = buildPlanEvidence(entry.source, entry.indexPlan);
      if (existing) {
        existing.evidence.push(evidence);
      } else {
        grouped.set(candidate.indexKey, { candidate, evidence: [evidence] });
      }
    }
  }

  const summaries = [...grouped.values()].map(({ candidate, evidence }) => ({
    indexKey: candidate.indexKey,
    indexKind: candidate.indexKind,
    accessPath: candidate.accessPath,
    indexStructure: candidate.indexStructure,
    fields: candidate.fields,
    sourceKind: candidate.fields.find((field) => field.sourceKind)?.sourceKind,
    formulaEvidence: formulaEvidenceFromFields(candidate.fields),
    optimizedSources: unique(evidence.map((item) => item.source)),
    optimizedQueryKinds: unique(evidence.map((item) => item.queryKind)),
    optimizedShapeHashes: unique(evidence.map((item) => item.shapeHash)),
    optimizedFields: candidate.fields.map(formatOptimizedField),
    reasonCodes: unique(evidence.flatMap((item) => item.reasonCodes)),
    riskLevels: unique(evidence.map((item) => item.riskLevel)),
    confidence: confidenceFromEvidence(evidence),
    planEvidence: evidence,
    nextAction: 'review_or_accept_recommended_index',
  }));

  const compositePrefixFields = new Set(
    summaries
      .filter((item) => item.indexKind === 'btree' && item.accessPath === 'composite')
      .map((item) => item.optimizedFields[0])
      .filter((field): field is string => Boolean(field))
      .map((field) => /\(([^)]+)\)/.exec(field)?.[1] ?? field.split(':')[0])
  );

  return summaries
    .filter((item) => {
      if (item.indexKind !== 'btree' || item.accessPath !== 'single_field') return true;
      const field = item.optimizedFields[0];
      if (!field) return true;
      const normalizedField = /\(([^)]+)\)/.exec(field)?.[1] ?? field.split(':')[0];
      return !compositePrefixFields.has(normalizedField);
    })
    .sort((a, b) => b.optimizedSources.length - a.optimizedSources.length);
};

type ExplainRecommendedIndexResult = TableQueryOpsExplainSavedViewsResult['results'][number];

const toPlannerCandidate = (result: ExplainRecommendedIndexResult): IndexSetPlannerCandidate => ({
  candidateId: result.recommendedIndex.indexKey,
  indexName: result.proposedIndexName,
  indexKind: result.proposedIndexKind,
  accessPath: result.proposedIndexAccessPath,
  indexStructure: result.recommendedIndex.indexStructure,
  fields: result.proposedIndexFields,
  coveredSourceIds: result.recommendedIndex.optimizedSources,
  coveredQueryKinds: result.recommendedIndex.optimizedQueryKinds,
  coveredShapeHashes: result.recommendedIndex.optimizedShapeHashes,
  reasonCodes: result.recommendedIndex.reasonCodes,
  riskLevels: result.recommendedIndex.riskLevels,
  explainStatus: result.explainStatus,
  explainCostBefore: result.explainCostBefore,
  explainCostAfter: result.explainCostAfter,
  explainCostDelta: result.explainCostDelta,
  explainCostDeltaPct: result.explainCostDeltaPct,
  plannerUsedIndex: result.explainUsesCandidateIndex,
  nextAction: result.nextAction,
});

const buildRecommendedIndexSet = (
  results: readonly ExplainRecommendedIndexResult[]
): {
  readonly recommendedIndexSet: readonly TableQueryOpsRecommendedIndexSetSummary[];
  readonly rejectedCandidates: readonly TableQueryOpsRejectedIndexCandidateSummary[];
} => {
  const resultByKey = new Map(results.map((result) => [result.recommendedIndex.indexKey, result]));
  const planned = planRecommendedIndexSet(results.map(toPlannerCandidate), {
    minCostImprovementPct: MIN_RECOMMENDED_COST_IMPROVEMENT_PCT,
  });

  const recommendedIndexSet = planned.recommendedIndexSet.map((item) => {
    const evidence = item.coveredCandidateIds
      .map((candidateId) => resultByKey.get(candidateId))
      .filter((result): result is ExplainRecommendedIndexResult => Boolean(result));
    const winner = resultByKey.get(item.candidateId) ?? evidence[0];
    return {
      indexKey: item.candidateId,
      indexName: item.indexName ?? winner?.proposedIndexName ?? item.candidateId,
      indexKind: item.indexKind,
      accessPath: item.accessPath,
      indexStructure: item.indexStructure,
      fields: item.fields,
      sourceKind: item.fields.find((field) => field.sourceKind)?.sourceKind,
      formulaEvidence: formulaEvidenceFromFields(item.fields),
      coveredSourceIds: unique(
        evidence.flatMap((result) => result.recommendedIndex.optimizedSources)
      ),
      coveredViewIds: unique(
        evidence.flatMap((result) => result.recommendedIndex.optimizedSources)
      ),
      coveredQueryKinds: unique(
        evidence.flatMap((result) => result.recommendedIndex.optimizedQueryKinds)
      ),
      coveredShapeHashes: unique(
        evidence.flatMap((result) => result.recommendedIndex.optimizedShapeHashes)
      ),
      costBefore: item.explainCostBefore,
      costAfter: item.explainCostAfter,
      costDelta: item.explainCostDelta,
      costDeltaPct: item.explainCostDeltaPct,
      plannerUsedIndex: item.plannerUsedIndex,
      nextAction: item.nextAction,
      coveredCandidateIds: item.coveredCandidateIds,
      rejectedCandidateIds: item.rejectedCandidateIds,
      evidence,
    };
  });

  const rejectedCandidates = planned.rejectedCandidates.map((item) => {
    const evidence = resultByKey.get(item.candidate.candidateId);
    return {
      indexKey: item.candidate.candidateId,
      indexName:
        item.candidate.indexName ?? evidence?.proposedIndexName ?? item.candidate.candidateId,
      indexKind: item.candidate.indexKind,
      accessPath: item.candidate.accessPath,
      fields: item.candidate.fields,
      sourceKind: item.candidate.fields.find((field) => field.sourceKind)?.sourceKind,
      formulaEvidence: formulaEvidenceFromFields(item.candidate.fields),
      coveredSourceIds: item.candidate.coveredSourceIds,
      nextAction: item.nextAction,
      rejectionReason: item.rejectionReason,
      ...(item.coveredByCandidateId ? { coveredByIndexKey: item.coveredByCandidateId } : {}),
      ...(evidence ? { evidence } : {}),
    };
  });

  return { recommendedIndexSet, rejectedCandidates };
};

const incrementReason = (reasons: Record<string, number>, reason: string) => {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
};

const normalizeSkippedReason = (analysis: TableQueryOpsSavedViewAnalysis): string | undefined => {
  if (analysis.skipped) return analysis.skipped;
  if (!analysis.error) return undefined;
  const message = analysis.error.toLowerCase();
  if (message.includes('unsupported') && message.includes('field')) return 'unsupported_field_type';
  if (message.includes('unsupported')) return 'unsupported_filter_operator';
  return 'query_sql_rebuild_failed';
};

const buildCoverageReport = (input: {
  readonly analyses: readonly TableQueryOpsSavedViewAnalysis[];
  readonly results: readonly ExplainRecommendedIndexResult[];
  readonly recommendedIndexSet: readonly TableQueryOpsRecommendedIndexSetSummary[];
  readonly rejectedCandidates: readonly TableQueryOpsRejectedIndexCandidateSummary[];
}): TableQueryOpsCoverageReportSummary => {
  const candidateKeysBySource = new Map<string, string[]>();
  const validatedBySource = new Set<string>();
  for (const result of input.results) {
    for (const source of result.recommendedIndex.optimizedSources) {
      candidateKeysBySource.set(source, [
        ...(candidateKeysBySource.get(source) ?? []),
        result.recommendedIndex.indexKey,
      ]);
      if (result.explainStatus === 'validated') validatedBySource.add(source);
    }
  }

  const recommendedKeysBySource = new Map<string, string[]>();
  for (const recommended of input.recommendedIndexSet) {
    for (const source of recommended.coveredSourceIds) {
      recommendedKeysBySource.set(source, [
        ...(recommendedKeysBySource.get(source) ?? []),
        recommended.indexKey,
      ]);
    }
  }

  const rejectedKeysBySource = new Map<string, string[]>();
  for (const rejected of input.rejectedCandidates) {
    for (const source of rejected.coveredSourceIds) {
      rejectedKeysBySource.set(source, [
        ...(rejectedKeysBySource.get(source) ?? []),
        rejected.indexKey,
      ]);
    }
  }

  const skippedReasons: Record<string, number> = {};
  const sources: TableQueryOpsSourceCoverageSummary[] = input.analyses.map((analysis) => {
    const statuses: TableQueryOpsSourceCoverageStatus[] = ['scanned'];
    const candidateIndexKeys = unique(candidateKeysBySource.get(analysis.viewId) ?? []);
    const recommendedIndexKeys = unique(recommendedKeysBySource.get(analysis.viewId) ?? []);
    const rejectedIndexKeys = unique(rejectedKeysBySource.get(analysis.viewId) ?? []);
    const skippedReason = normalizeSkippedReason(analysis);

    if (analysis.shapeHash) {
      statuses.push('parsed', 'shape_created');
    }
    if (candidateIndexKeys.length > 0) statuses.push('candidate_generated');
    if (validatedBySource.has(analysis.viewId)) statuses.push('explain_validated');
    if (rejectedIndexKeys.length > 0) statuses.push('rejected');
    if (skippedReason) {
      statuses.push('skipped');
      incrementReason(skippedReasons, skippedReason);
    }

    return {
      sourceType: 'saved_view',
      sourceId: analysis.viewId,
      tableId: analysis.tableId,
      statuses,
      ...(analysis.shapeHash ? { shapeHash: analysis.shapeHash } : {}),
      ...(analysis.queryKind ? { queryKind: analysis.queryKind } : {}),
      candidateIndexKeys,
      recommendedIndexKeys,
      rejectedIndexKeys,
      ...(skippedReason ? { skippedReason } : {}),
      ...(analysis.error ? { error: analysis.error } : {}),
    };
  });

  const countWithStatus = (status: TableQueryOpsSourceCoverageStatus) =>
    sources.filter((source) => source.statuses.includes(status)).length;
  const formulaFields = uniqueFormulaEvidence([
    ...input.results.flatMap((result) => (result.formulaEvidence ? [result.formulaEvidence] : [])),
    ...input.recommendedIndexSet.flatMap((item) =>
      item.formulaEvidence ? [item.formulaEvidence] : []
    ),
    ...input.rejectedCandidates.flatMap((item) =>
      item.formulaEvidence ? [item.formulaEvidence] : []
    ),
  ]);
  const formulaSkippedReasons = formulaFields.reduce<Record<string, number>>((acc, field) => {
    for (const reason of [
      ...field.skippedReasons,
      ...(field.predicatePushdown?.skippedReasons ?? []),
    ]) {
      incrementReason(acc, reason);
    }
    return acc;
  }, {});

  return {
    scannedSourceCount: sources.length,
    parsedSourceCount: countWithStatus('parsed'),
    shapeCreatedSourceCount: countWithStatus('shape_created'),
    candidateGeneratedSourceCount: countWithStatus('candidate_generated'),
    explainValidatedSourceCount: countWithStatus('explain_validated'),
    rejectedSourceCount: countWithStatus('rejected'),
    skippedSourceCount: countWithStatus('skipped'),
    skippedReasons,
    formulaFields,
    scannedFormulaFieldCount: formulaFields.length,
    validatedFormulaFieldCount: formulaFields.filter((field) =>
      input.recommendedIndexSet.some(
        (item) => item.formulaEvidence?.formulaFieldId === field.formulaFieldId
      )
    ).length,
    rejectedFormulaFieldCount: formulaFields.filter((field) =>
      input.rejectedCandidates.some(
        (item) => item.formulaEvidence?.formulaFieldId === field.formulaFieldId
      )
    ).length,
    skippedFormulaFieldCount: formulaFields.filter(
      (field) =>
        field.skippedReasons.length > 0 || (field.predicatePushdown?.skippedReasons.length ?? 0) > 0
    ).length,
    formulaSkippedReasons,
    sources,
  };
};

const riskRank: Record<TableQueryOpsQueryRiskReportSummary['riskLevel'], number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  none: 1,
};

const inferRiskNextAction = (input: {
  readonly analysis: TableQueryOpsSavedViewAnalysis;
  readonly results: readonly ExplainRecommendedIndexResult[];
  readonly recommendedIndexKeys: readonly string[];
  readonly rejectedIndexKeys: readonly string[];
}): TableQueryOpsQueryRiskReportSummary['remediationSummary']['nextAction'] => {
  if (input.recommendedIndexKeys.length > 0) return 'ready_for_confirmation';
  if (input.rejectedIndexKeys.length > 0) return 'candidate_not_recommended';
  if (input.results.some((result) => result.nextAction === 'needs_plan_validation')) {
    return 'needs_plan_validation';
  }
  if ((input.analysis.indexPlan?.candidateIndexes.length ?? 0) > 0) return 'needs_plan_validation';
  if (
    input.analysis.indexPlan?.riskLevel === 'critical' ||
    input.analysis.indexPlan?.riskLevel === 'high' ||
    input.analysis.indexPlan?.riskLevel === 'medium'
  ) {
    return 'manual_investigation';
  }
  return 'no_index_change';
};

const buildQueryRiskReports = (input: {
  readonly analyses: readonly TableQueryOpsSavedViewAnalysis[];
  readonly results: readonly ExplainRecommendedIndexResult[];
  readonly recommendedIndexSet: readonly TableQueryOpsRecommendedIndexSetSummary[];
  readonly rejectedCandidates: readonly TableQueryOpsRejectedIndexCandidateSummary[];
}): readonly TableQueryOpsQueryRiskReportSummary[] => {
  const resultsBySource = new Map<string, ExplainRecommendedIndexResult[]>();
  for (const result of input.results) {
    for (const source of result.recommendedIndex.optimizedSources) {
      resultsBySource.set(source, [...(resultsBySource.get(source) ?? []), result]);
    }
  }

  const recommendedKeysBySource = new Map<string, string[]>();
  for (const recommended of input.recommendedIndexSet) {
    for (const source of recommended.coveredSourceIds) {
      recommendedKeysBySource.set(source, [
        ...(recommendedKeysBySource.get(source) ?? []),
        recommended.indexKey,
      ]);
    }
  }

  const rejectedKeysBySource = new Map<string, string[]>();
  for (const rejected of input.rejectedCandidates) {
    for (const source of rejected.coveredSourceIds) {
      rejectedKeysBySource.set(source, [
        ...(rejectedKeysBySource.get(source) ?? []),
        rejected.indexKey,
      ]);
    }
  }

  return input.analyses
    .filter((analysis) => analysis.indexPlan)
    .map((analysis) => {
      const indexPlan = analysis.indexPlan!;
      const results = resultsBySource.get(analysis.viewId) ?? [];
      const evidence = results.find((result) => result.explainStatus === 'validated') ?? results[0];
      const recommendedIndexKeys = unique(recommendedKeysBySource.get(analysis.viewId) ?? []);
      const rejectedIndexKeys = unique(rejectedKeysBySource.get(analysis.viewId) ?? []);
      return {
        sourceType: 'saved_view' as const,
        sourceId: analysis.viewId,
        tableId: analysis.tableId,
        queryKind: indexPlan.queryKind,
        shapeHash: indexPlan.shapeHash,
        riskLevel: indexPlan.riskLevel as TableQueryOpsQueryRiskReportSummary['riskLevel'],
        riskScore: indexPlan.riskScore,
        reasonCodes: [...indexPlan.reasonCodes],
        shapeSummary: indexPlan.shapeSummary,
        physicalStats: indexPlan.physicalStats,
        indexInventory: {
          state: indexPlan.indexState,
          existingIndexStructures: [...indexPlan.existingIndexStructures],
          candidateIndexStructures: [...indexPlan.candidateIndexStructures],
          abnormalIndexes: [...indexPlan.abnormalIndexes],
        },
        ...(evidence
          ? {
              planEvidence: {
                explainStatus: evidence.explainStatus,
                ...(evidence.explainMethod ? { explainMethod: evidence.explainMethod } : {}),
                ...(evidence.explainReason ? { explainReason: evidence.explainReason } : {}),
                ...(typeof evidence.explainCostBefore === 'number'
                  ? { costBefore: evidence.explainCostBefore }
                  : {}),
                ...(typeof evidence.explainCostAfter === 'number'
                  ? { costAfter: evidence.explainCostAfter }
                  : {}),
                ...(typeof evidence.explainCostDeltaPct === 'number'
                  ? { costDeltaPct: evidence.explainCostDeltaPct }
                  : {}),
                ...(evidence.explainPlanNodeBefore
                  ? { planNodeBefore: evidence.explainPlanNodeBefore }
                  : {}),
                ...(evidence.explainPlanNodeAfter
                  ? { planNodeAfter: evidence.explainPlanNodeAfter }
                  : {}),
                ...(typeof evidence.explainUsesCandidateIndex === 'boolean'
                  ? { usesCandidateIndex: evidence.explainUsesCandidateIndex }
                  : {}),
              },
            }
          : {}),
        remediationSummary: {
          hasIndexRecommendation: recommendedIndexKeys.length > 0,
          recommendedIndexKeys,
          rejectedIndexKeys,
          nextAction: inferRiskNextAction({
            analysis,
            results,
            recommendedIndexKeys,
            rejectedIndexKeys,
          }),
        },
      };
    })
    .sort((a, b) => riskRank[b.riskLevel] - riskRank[a.riskLevel] || b.riskScore - a.riskScore);
};

const remediationKindForRecommendedIndex = (
  index: TableQueryOpsRecommendedIndexSummary
): ExecutablePhase1RemediationKind => {
  if (index.indexKind === 'gin_trgm') return 'create_search_index';
  if (index.fields.some((field) => field.role === 'sort' || field.role === 'group')) {
    return 'create_sort_index';
  }
  return 'create_filter_index';
};

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const splitPhysicalName = (
  dbTableName: string,
  defaultSchema: string
): { readonly schema: string; readonly tableName: string } => {
  const dotIndex = dbTableName.indexOf('.');
  if (dotIndex === -1) return { schema: defaultSchema, tableName: dbTableName };
  return { schema: dbTableName.slice(0, dotIndex), tableName: dbTableName.slice(dotIndex + 1) };
};

const buildProposedIndexName = (
  tableId: string,
  index: TableQueryOpsRecommendedIndexSummary
): string => {
  const fieldKey = index.fields
    .map((field) => field.fieldDbName ?? field.fieldId ?? 'field')
    .join('_')
    .replace(/\W/g, '_')
    .slice(0, 24);
  return `tqops_${tableId}_${fieldKey}_${index.indexKind}`.slice(0, 60);
};

const buildHypotheticalIndexStatement = (
  schema: string,
  tableName: string,
  index: TableQueryOpsRecommendedIndexSummary,
  expressionSql?: string
): string | undefined => {
  const tableSql = `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`;
  if (index.accessPath === 'expression') {
    if (!expressionSql || index.indexKind !== 'btree') return undefined;
    return `CREATE INDEX ON ${tableSql} USING btree ((${expressionSql}))`;
  }
  const fields = index.fields.filter((field) => field.fieldDbName);
  if (fields.length === 0) return undefined;
  if (index.indexKind === 'gin_trgm') {
    return `CREATE INDEX ON ${tableSql} USING gin (${quoteIdentifier(
      fields[0]?.fieldDbName ?? ''
    )} gin_trgm_ops)`;
  }
  const fieldSql = fields
    .map((field) => {
      const direction = field.direction ? ` ${field.direction.toUpperCase()}` : '';
      return `${quoteIdentifier(field.fieldDbName ?? '')}${direction}`;
    })
    .join(', ');
  return `CREATE INDEX ON ${tableSql} USING btree (${fieldSql})`;
};

const buildFormulaExpressionIndexSql = (
  table: Table,
  index: TableQueryOpsRecommendedIndexSummary
): string | undefined => {
  const evidence = index.formulaEvidence;
  if (index.accessPath !== 'expression' || evidence?.sourceKind !== 'formula_expression') {
    return undefined;
  }
  const formulaField = table
    .getFields()
    .find((field) => field.id().toString() === evidence.formulaFieldId);
  if (!formulaField?.type().equals(FieldType.formula())) return undefined;
  const translator = new FormulaSqlPgTranslator({
    table,
    tableAlias: '',
    allowFieldNameFallback: false,
    typeValidationStrategy: new Pg16TypeValidationStrategy(),
    resolveFieldSql: (field: Field) => {
      const dbFieldName = field.dbFieldName().andThen((name) => name.value());
      const columnSql = dbFieldName.isOk() ? quoteIdentifier(dbFieldName.value) : 'NULL';
      return ok(makeExpr(columnSql, 'unknown', false, undefined, undefined, field));
    },
  });
  const translated = translator.translateExpression(
    (formulaField as FormulaField).expression().toString()
  );
  if (translated.isErr()) return undefined;
  const expressionSql = translator.renderSql(translated.value);
  return expressionSql;
};

const explainCompiled = async (
  db: Kysely<UnknownRow>,
  compiled: CompiledSql
): Promise<ExplainPlan> => {
  const result = await db.executeQuery<ExplainRow>(
    CompiledQuery.raw(`EXPLAIN (FORMAT JSON) ${compiled.sql}`, [...compiled.parameters])
  );
  return parseExplainPlan(result.rows[0]?.['QUERY PLAN']);
};

const parseExplainPlan = (value: unknown): ExplainPlan => {
  const root = Array.isArray(value) ? value[0] : value;
  const plan = root && typeof root === 'object' ? (root as { Plan?: unknown }).Plan : undefined;
  if (!plan || typeof plan !== 'object') return { rawPlan: value };
  const typed = plan as Record<string, unknown>;
  return {
    startupCost: toOptionalNumber(typed['Startup Cost']),
    totalCost: toOptionalNumber(typed['Total Cost']),
    nodeType: typeof typed['Node Type'] === 'string' ? typed['Node Type'] : undefined,
    indexName: findFirstIndexName(plan),
    rawPlan: value,
  };
};

const findFirstIndexName = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstIndexName(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['Index Name'] === 'string') return record['Index Name'];
  for (const child of Object.values(record)) {
    const found = findFirstIndexName(child);
    if (found) return found;
  }
  return undefined;
};

const toOptionalNumber = (value: unknown): number | undefined => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const readHypopgSchema = async (db: Kysely<UnknownRow>): Promise<string | undefined> => {
  const result = await sql<{ schema_name: string }>`
    SELECT n.nspname AS schema_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'hypopg_create_index'
    LIMIT 1
  `.execute(db);
  return result.rows[0]?.schema_name;
};

const resetHypopg = async (db: Kysely<UnknownRow>, schema: string): Promise<void> => {
  await sql`SELECT ${sql.raw(quoteIdentifier(schema))}.hypopg_reset()`.execute(db);
};

const planReferencesHypotheticalIndex = (value: unknown): boolean => {
  if (typeof value === 'string') return value.includes('<') && value.includes('>');
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(planReferencesHypotheticalIndex);
  return Object.values(value as Record<string, unknown>).some(planReferencesHypotheticalIndex);
};

const explainCostDelta = (before?: number, after?: number): number | undefined =>
  typeof before === 'number' && typeof after === 'number' ? after - before : undefined;

const explainCostDeltaPct = (before?: number, after?: number): number | undefined => {
  const delta = explainCostDelta(before, after);
  return typeof delta === 'number' && typeof before === 'number' && before > 0
    ? Number(((delta / before) * 100).toFixed(2))
    : undefined;
};

const scopeSql = (scope: TableQueryOpsScopeInput, alias: string) => sql`
  ${scope.baseId ? sql`AND ${sql.ref(`${alias}.base_id`)} = ${scope.baseId}` : sql``}
  ${scope.tableId ? sql`AND ${sql.ref(`${alias}.table_id`)} = ${scope.tableId}` : sql``}
`;

const spaceScopeSql = (scope: TableQueryOpsScopeInput, alias: string) => sql`
  ${
    scope.spaceId
      ? sql`AND (${sql.ref(`${alias}.space_id`)} = ${scope.spaceId} OR scope_b.space_id = ${scope.spaceId})`
      : sql``
  }
`;

const viewScopeSql = (scope: TableQueryOpsScopeInput) => sql`
  ${scope.spaceId ? sql`AND b.space_id = ${scope.spaceId}` : sql``}
  ${scope.baseId ? sql`AND tm.base_id = ${scope.baseId}` : sql``}
  ${scope.tableId ? sql`AND v.table_id = ${scope.tableId}` : sql``}
`;

const createContext = (container: {
  isRegistered(token: unknown): boolean;
  resolve<T>(token: unknown): T;
}) => {
  const actorId = ActorId.create('cli-table-query-ops');
  if (actorId.isErr()) throw actorId.error;
  const context: IExecutionContext = {
    actorId: actorId.value,
    requestId: 'teable-devtools:table-query-ops',
    $t: (key) => key,
    ...(container.isRegistered(v2CoreTokens.tracer)
      ? { tracer: container.resolve<ITracer>(v2CoreTokens.tracer) }
      : {}),
  };
  return context;
};

const parseObservationInput = (raw: unknown): TableQueryObservationWindow => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Observation must be a JSON object');
  }
  const input = raw as Record<string, unknown>;
  const shapeResult = TableQueryShape.create(input.shape);
  if (shapeResult.isErr()) throw shapeResult.error;

  const windowStartRaw = input.windowStart;
  const windowStart =
    windowStartRaw instanceof Date
      ? windowStartRaw
      : typeof windowStartRaw === 'string'
        ? new Date(windowStartRaw)
        : undefined;
  if (!windowStart || Number.isNaN(windowStart.getTime())) {
    throw new Error('Observation windowStart must be an ISO date string');
  }

  const observationResult = TableQueryObservationWindow.create({
    ...(typeof input.spaceId === 'string' ? { spaceId: input.spaceId } : {}),
    baseId: String(input.baseId ?? ''),
    tableId: String(input.tableId ?? ''),
    windowStart,
    windowSizeSeconds: Number(input.windowSizeSeconds ?? 300),
    shape: shapeResult.value,
    requestCount: Number(input.requestCount ?? 1),
    slowCount: Number(input.slowCount ?? 0),
    timeoutCount: Number(input.timeoutCount ?? 0),
    dbErrorCount: Number(input.dbErrorCount ?? 0),
    totalDurationMs: Number(input.totalDurationMs ?? 0),
    maxDurationMs: Number(input.maxDurationMs ?? 0),
    ...(input.totalDbDurationMs == null
      ? {}
      : { totalDbDurationMs: Number(input.totalDbDurationMs) }),
    ...(input.maxDbDurationMs == null ? {} : { maxDbDurationMs: Number(input.maxDbDurationMs) }),
    ...(Array.isArray(input.sqlDiagnostics)
      ? {
          sqlDiagnostics:
            input.sqlDiagnostics as TableQueryObservationWindowInput['sqlDiagnostics'],
        }
      : {}),
  });
  if (observationResult.isErr()) throw observationResult.error;
  return observationResult.value;
};

export const TableQueryOpsLive = Layer.effect(
  TableQueryOps,
  Effect.gen(function* () {
    const { container } = yield* Database;
    const metaDb = container.resolve(v2MetaDbTokens.db) as Kysely<UnknownRow>;
    const dataDb = container.resolve(v2DataDbTokens.db) as Kysely<UnknownRow>;
    const registration: TableOpsRegistration = {
      registeredCore: false,
      schemaEnsured: false,
    };

    const ensureRegistered = async (ensureSchema: boolean) => {
      if (!registration.registeredCore) {
        registerV2TableOps(container);
        registration.registeredCore = true;
      }
      await registerV2TableOpsPostgresAdapter(container, {
        metaDb,
        dataDb,
        ensureSchema: ensureSchema && !registration.schemaEnsured,
      });
      registration.schemaEnsured = registration.schemaEnsured || ensureSchema;
    };

    const hasOpsTables = async () => {
      const result = await sql<{ enabled: boolean }>`
        SELECT (
          to_regclass('table_query_observation_window') IS NOT NULL
          AND to_regclass('table_query_recommendation') IS NOT NULL
          AND to_regclass('table_query_remediation_task') IS NOT NULL
        ) AS enabled
      `.execute(metaDb);
      return Boolean(result.rows[0]?.enabled);
    };

    const loadSavedViewRows = async (
      input: TableQueryOpsAnalyzeSavedViewsInput
    ): Promise<SavedViewRow[]> => {
      const limit = input.limit ?? 100;
      const result = await sql<SavedViewRow>`
        SELECT
          v.id AS view_id,
          b.space_id AS space_id,
          tm.base_id AS base_id,
          v.table_id AS table_id,
          v.filter AS filter,
          v.sort AS sort,
          v."group" AS "group",
          v.last_modified_time AS last_modified_time
        FROM "view" v
        JOIN table_meta tm ON tm.id = v.table_id
        JOIN base b ON b.id = tm.base_id
        WHERE v.deleted_time IS NULL
          AND tm.deleted_time IS NULL
          AND b.deleted_time IS NULL
          AND (
            coalesce(length(v.sort), 0) > 2
            OR coalesce(length(v.filter), 0) > 2
            OR coalesce(length(v."group"), 0) > 2
          )
          ${viewScopeSql(input)}
        ORDER BY v.last_modified_time DESC
        LIMIT ${limit}
      `.execute(metaDb);
      return result.rows;
    };

    const analyzeSavedViewsUnsafe = async (
      input: TableQueryOpsAnalyzeSavedViewsInput
    ): Promise<TableQueryOpsAnalyzeSavedViewsResult> => {
      await ensureRegistered(input.ensureSchema ?? true);
      const context = createContext(container);
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
      const rows = await loadSavedViewRows(input);
      const tableCache = new Map<string, Awaited<ReturnType<ITableRepository['findOne']>>>();
      const analyses: TableQueryOpsSavedViewAnalysis[] = [];

      for (const row of rows) {
        try {
          let tableResult = tableCache.get(row.table_id);
          if (!tableResult) {
            const tableId = TableId.create(row.table_id);
            if (tableId.isErr()) throw tableId.error;
            tableResult = await tableRepository.findOne(
              context,
              TableByIdSpec.create(tableId.value)
            );
            tableCache.set(row.table_id, tableResult);
          }
          if (tableResult.isErr()) throw tableResult.error;
          const observation = buildSavedViewConfigObservation({
            table: tableResult.value,
            viewId: row.view_id,
            spaceId: row.space_id ?? undefined,
            filter: row.filter,
            sort: row.sort,
            group: row.group,
            now: row.last_modified_time ? new Date(row.last_modified_time) : new Date(),
          });
          if (observation.isErr()) throw observation.error;
          if (!observation.value) {
            analyses.push({
              viewId: row.view_id,
              spaceId: row.space_id,
              baseId: row.base_id,
              tableId: row.table_id,
              skipped: 'empty_query_shape',
            });
            continue;
          }
          const result = await commandBus.execute(
            context,
            new AnalyzeAndRecommendTableQueryCommand(observation.value)
          );
          if (result.isErr()) throw result.error;
          const value = result.value as AnalyzeAndRecommendTableQueryResult;
          analyses.push({
            viewId: row.view_id,
            spaceId: row.space_id,
            baseId: row.base_id,
            tableId: row.table_id,
            shapeHash: observation.value.shapeHash(),
            queryKind: observation.value.shape().queryKind(),
            report: value.report.snapshot(),
            indexPlan: buildIndexPlanSummary({
              viewId: row.view_id,
              queryKind: observation.value.shape().queryKind(),
              shapeHash: observation.value.shapeHash(),
              report: value.report,
            }),
            recommendation: value.recommendation?.snapshot(),
          });
        } catch (error) {
          analyses.push({
            viewId: row.view_id,
            spaceId: row.space_id,
            baseId: row.base_id,
            tableId: row.table_id,
            error: error instanceof Error ? error.message : String(error),
            errorDetails: getErrorDetails(error),
          });
        }
      }

      return {
        scope: input,
        scannedViewCount: rows.length,
        observationCount: analyses.filter((item) => item.shapeHash).length,
        recommendationCount: analyses.filter((item) => item.recommendation).length,
        recommendedIndexes: buildRecommendedIndexes(
          analyses
            .filter(
              (
                item
              ): item is TableQueryOpsSavedViewAnalysis & {
                readonly indexPlan: TableQueryOpsIndexPlanSummary;
              } => Boolean(item.indexPlan)
            )
            .map((item) => ({
              source: item.viewId,
              indexPlan: item.indexPlan,
            }))
        ),
        analyses,
      };
    };

    const rowOrderColumnExists = async (table: Table, viewId: string): Promise<boolean> => {
      const dbTableName = table.dbTableName();
      if (dbTableName.isErr()) return false;
      const tableName = dbTableName.value.value();
      if (tableName.isErr()) return false;
      const physical = splitPhysicalName(tableName.value, table.baseId().toString());
      const result = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = ${physical.schema}
            AND table_name = ${physical.tableName}
            AND column_name = ${`__row_${viewId}`}
        ) AS "exists"
      `.execute(dataDb);
      return Boolean(result.rows[0]?.exists);
    };

    const buildSavedViewCompiledSql = async (
      context: IExecutionContext,
      table: Table,
      viewId: string
    ): Promise<CompiledSql> => {
      const view = table.getViewById(viewId);
      if (view.isErr()) throw view.error;
      const queryDefaults = view.value.queryDefaults();
      if (queryDefaults.isErr()) throw queryDefaults.error;
      const defaults = queryDefaults.value;
      const queryBuilderManager = container.resolve<TableRecordQueryBuilderManager>(
        v2RecordRepositoryPostgresTokens.tableRecordQueryBuilderManager
      );
      const builderResult = await queryBuilderManager.createBuilder(context, table, {
        mode: 'stored',
      });
      if (builderResult.isErr()) throw builderResult.error;
      const builder = builderResult.value;

      const filter = defaults.filter();
      if (filter) {
        const sanitized = sanitizeRecordFilter(table, filter);
        if (sanitized.isErr()) throw sanitized.error;
        const spec = sanitized.value ? buildRecordConditionSpec(table, sanitized.value) : undefined;
        if (!spec) {
          // All filter nodes were invalid/stale; match list-record behavior and skip the filter.
        } else if (spec.isErr()) {
          throw spec.error;
        } else {
          builder.where(spec.value);
        }
      }

      const orderBy = await buildSavedViewOrderBy(table, viewId, defaults);
      for (const item of orderBy) {
        if ('fieldId' in item) {
          builder.orderBy(item.fieldId, item.direction);
        } else {
          builder.orderBy(item.column, item.direction);
        }
      }
      builder.limit(100).offset(0);
      const built = builder.build();
      if (built.isErr()) throw built.error;
      return built.value.compile();
    };

    const buildSavedViewOrderBy = async (
      table: Table,
      viewId: string,
      defaults: {
        readonly sort: () => ReadonlyArray<{ fieldId: string; order: 'asc' | 'desc' }> | undefined;
        readonly group: () => ReadonlyArray<{ fieldId: string; order: 'asc' | 'desc' }> | undefined;
        readonly manualSort: () => boolean | undefined;
      }
    ): Promise<
      ReadonlyArray<
        | { readonly fieldId: FieldId; readonly direction: 'asc' | 'desc' }
        | { readonly column: '__auto_number' | `__row_${string}`; readonly direction: 'asc' }
      >
    > => {
      const result: Array<
        | { readonly fieldId: FieldId; readonly direction: 'asc' | 'desc' }
        | { readonly column: '__auto_number' | `__row_${string}`; readonly direction: 'asc' }
      > = [];
      const seen = new Set<string>();
      const pushField = (raw: { fieldId: string; order: 'asc' | 'desc' }) => {
        const fieldId = FieldId.create(raw.fieldId);
        if (fieldId.isErr()) return;
        const key = `field:${fieldId.value.toString()}`;
        if (seen.has(key)) return;
        seen.add(key);
        result.push({ fieldId: fieldId.value, direction: raw.order });
      };
      defaults.group()?.forEach(pushField);
      if (!defaults.manualSort()) {
        defaults.sort()?.forEach(pushField);
      }
      if (await rowOrderColumnExists(table, viewId)) {
        result.push({ column: `__row_${viewId}`, direction: 'asc' });
      }
      result.push({ column: '__auto_number', direction: 'asc' });
      return result;
    };

    const explainRecommendedIndex = async (input: {
      readonly context: IExecutionContext;
      readonly table: Table;
      readonly recommendedIndex: TableQueryOpsRecommendedIndexSummary;
    }): Promise<TableQueryOpsExplainSavedViewsResult['results'][number]> => {
      const representativeViewId = input.recommendedIndex.optimizedSources[0];
      const proposedIndexName = buildProposedIndexName(
        input.table.id().toString(),
        input.recommendedIndex
      );
      const base = {
        recommendedIndex: input.recommendedIndex,
        proposedIndexName,
        proposedIndexKind: input.recommendedIndex.indexKind,
        proposedIndexAccessPath: input.recommendedIndex.accessPath,
        proposedIndexFields: input.recommendedIndex.fields,
        sourceKind: input.recommendedIndex.sourceKind,
        formulaEvidence: input.recommendedIndex.formulaEvidence,
        ...(representativeViewId ? { representativeViewId } : {}),
      };
      if (!representativeViewId) {
        return {
          ...base,
          explainStatus: 'skipped',
          explainReason: 'representative_view_missing',
          nextAction: 'manual_investigation',
        };
      }

      const dbTableName = input.table.dbTableName();
      if (dbTableName.isErr()) throw dbTableName.error;
      const tableName = dbTableName.value.value();
      if (tableName.isErr()) throw tableName.error;
      const physical = splitPhysicalName(tableName.value, input.table.baseId().toString());
      const formulaExpressionSql = buildFormulaExpressionIndexSql(
        input.table,
        input.recommendedIndex
      );
      if (input.recommendedIndex.accessPath === 'expression' && !formulaExpressionSql) {
        return {
          ...base,
          explainStatus: 'skipped',
          explainReason: 'formula_sql_translate_failed',
          nextAction: 'manual_investigation',
        };
      }
      const hypotheticalIndexStatement = buildHypotheticalIndexStatement(
        physical.schema,
        physical.tableName,
        input.recommendedIndex,
        formulaExpressionSql
      );
      if (!hypotheticalIndexStatement) {
        return {
          ...base,
          explainStatus: 'skipped',
          explainReason: 'candidate_index_statement_missing',
          nextAction: 'manual_investigation',
        };
      }

      try {
        return await dataDb.connection().execute(async (db) => {
          const compiled = await buildSavedViewCompiledSql(
            input.context,
            input.table,
            representativeViewId
          );
          const before = await explainCompiled(db as Kysely<UnknownRow>, compiled);
          const hypopgSchema = await readHypopgSchema(db as Kysely<UnknownRow>);
          if (!hypopgSchema) {
            return {
              ...base,
              explainStatus: 'validated',
              explainMethod: 'explain',
              explainReason: 'hypopg_extension_unavailable',
              explainCostBefore: before.totalCost,
              explainPlanNodeBefore: before.nodeType,
              hypotheticalIndexStatement,
              nextAction: 'needs_hypopg_or_manual_review',
            };
          }
          await resetHypopg(db as Kysely<UnknownRow>, hypopgSchema);
          await sql`
            SELECT * FROM ${sql.raw(quoteIdentifier(hypopgSchema))}.hypopg_create_index(${hypotheticalIndexStatement})
          `.execute(db);
          const after = await explainCompiled(db as Kysely<UnknownRow>, compiled);
          await resetHypopg(db as Kysely<UnknownRow>, hypopgSchema);
          const delta = explainCostDelta(before.totalCost, after.totalCost);
          const deltaPct = explainCostDeltaPct(before.totalCost, after.totalCost);
          const usesCandidateIndex =
            Boolean(after.indexName) || planReferencesHypotheticalIndex(after.rawPlan);
          const hasMeaningfulCostImprovement =
            typeof deltaPct === 'number' && deltaPct <= -MIN_RECOMMENDED_COST_IMPROVEMENT_PCT;
          const readyForConfirmation = usesCandidateIndex && hasMeaningfulCostImprovement;
          return {
            ...base,
            explainStatus: 'validated',
            explainMethod: 'hypothetical_index',
            explainReason: readyForConfirmation
              ? 'cost_improved'
              : usesCandidateIndex
                ? 'cost_improvement_below_threshold'
                : 'hypothetical_index_not_used',
            explainCostBefore: before.totalCost,
            explainCostAfter: after.totalCost,
            explainCostDelta: delta,
            explainCostDeltaPct: deltaPct,
            explainPlanNodeBefore: before.nodeType,
            explainPlanNodeAfter: after.nodeType,
            explainUsesCandidateIndex: usesCandidateIndex,
            hypotheticalIndexStatement,
            nextAction: readyForConfirmation
              ? 'ready_for_confirmation'
              : 'candidate_not_recommended',
          };
        });
      } catch (error) {
        return {
          ...base,
          explainStatus: 'failed',
          explainReason: 'explain_failed',
          error: error instanceof Error ? error.message : String(error),
          hypotheticalIndexStatement,
          nextAction: 'manual_investigation',
        };
      }
    };

    return {
      getOverview: (
        input: TableQueryOpsOverviewInput
      ): Effect.Effect<TableQueryOpsOverviewResult, CliError> =>
        Effect.tryPromise({
          try: async () => {
            await ensureRegistered(Boolean(input.ensureSchema));
            const enabled = await hasOpsTables();
            const emptySummary = {
              enabled,
              observationWindowCount: 0,
              requestCount: 0,
              slowCount: 0,
              timeoutCount: 0,
              dbErrorCount: 0,
              recommendationCount: 0,
              openRecommendationCount: 0,
              acceptedRecommendationCount: 0,
              taskCount: 0,
              runningTaskCount: 0,
              failedTaskCount: 0,
            };
            if (!enabled) {
              return {
                scope: input,
                summary: emptySummary,
                hotTables: [],
                recommendations: { total: 0, data: [] },
                tasks: { total: 0, data: [] },
              };
            }

            const limit = input.limit ?? 20;
            const [summaryRows, hotTableRows, recommendationRows, taskRows] = await Promise.all([
              sql<CountRow>`
                SELECT
                  (SELECT count(*) FROM table_query_observation_window ow
                    LEFT JOIN base scope_b ON scope_b.id = ow.base_id
                    WHERE true ${scopeSql(input, 'ow')} ${spaceScopeSql(input, 'ow')}
                  ) AS observation_window_count,
                  (SELECT coalesce(sum(ow.request_count), 0) FROM table_query_observation_window ow
                    LEFT JOIN base scope_b ON scope_b.id = ow.base_id
                    WHERE true ${scopeSql(input, 'ow')} ${spaceScopeSql(input, 'ow')}
                  ) AS request_count,
                  (SELECT coalesce(sum(ow.slow_count), 0) FROM table_query_observation_window ow
                    LEFT JOIN base scope_b ON scope_b.id = ow.base_id
                    WHERE true ${scopeSql(input, 'ow')} ${spaceScopeSql(input, 'ow')}
                  ) AS slow_count,
                  (SELECT coalesce(sum(ow.timeout_count), 0) FROM table_query_observation_window ow
                    LEFT JOIN base scope_b ON scope_b.id = ow.base_id
                    WHERE true ${scopeSql(input, 'ow')} ${spaceScopeSql(input, 'ow')}
                  ) AS timeout_count,
                  (SELECT coalesce(sum(ow.db_error_count), 0) FROM table_query_observation_window ow
                    LEFT JOIN base scope_b ON scope_b.id = ow.base_id
                    WHERE true ${scopeSql(input, 'ow')} ${spaceScopeSql(input, 'ow')}
                  ) AS db_error_count,
                  (SELECT count(*) FROM table_query_recommendation rec
                    LEFT JOIN base scope_b ON scope_b.id = rec.base_id
                    WHERE true ${scopeSql(input, 'rec')} ${spaceScopeSql(input, 'rec')}
                  ) AS recommendation_count,
                  (SELECT count(*) FROM table_query_recommendation rec
                    LEFT JOIN base scope_b ON scope_b.id = rec.base_id
                    WHERE rec.status = 'open' ${scopeSql(input, 'rec')} ${spaceScopeSql(input, 'rec')}
                  ) AS open_recommendation_count,
                  (SELECT count(*) FROM table_query_recommendation rec
                    LEFT JOIN base scope_b ON scope_b.id = rec.base_id
                    WHERE rec.status = 'accepted' ${scopeSql(input, 'rec')} ${spaceScopeSql(input, 'rec')}
                  ) AS accepted_recommendation_count,
                  (SELECT count(*) FROM table_query_remediation_task task
                    LEFT JOIN base scope_b ON scope_b.id = task.base_id
                    WHERE true ${scopeSql(input, 'task')} ${input.spaceId ? sql`AND scope_b.space_id = ${input.spaceId}` : sql``}
                  ) AS task_count,
                  (SELECT count(*) FROM table_query_remediation_task task
                    LEFT JOIN base scope_b ON scope_b.id = task.base_id
                    WHERE task.status = 'running' ${scopeSql(input, 'task')} ${
                      input.spaceId ? sql`AND scope_b.space_id = ${input.spaceId}` : sql``
                    }
                  ) AS running_task_count,
                  (SELECT count(*) FROM table_query_remediation_task task
                    LEFT JOIN base scope_b ON scope_b.id = task.base_id
                    WHERE task.status = 'failed' ${scopeSql(input, 'task')} ${
                      input.spaceId ? sql`AND scope_b.space_id = ${input.spaceId}` : sql``
                    }
                  ) AS failed_task_count
              `.execute(metaDb),
              sql<HotTableRow>`
                SELECT
                  coalesce(ow.space_id, b.space_id) AS space_id,
                  ow.base_id,
                  ow.table_id,
                  sum(ow.request_count) AS request_count,
                  sum(ow.slow_count) AS slow_count,
                  sum(ow.timeout_count) AS timeout_count,
                  sum(ow.db_error_count) AS db_error_count,
                  max(ow.max_duration_ms) AS max_duration_ms,
                  max(ow.window_start) AS latest_window_start
                FROM table_query_observation_window ow
                LEFT JOIN base b ON b.id = ow.base_id
                LEFT JOIN base scope_b ON scope_b.id = ow.base_id
                WHERE true ${scopeSql(input, 'ow')} ${spaceScopeSql(input, 'ow')}
                GROUP BY coalesce(ow.space_id, b.space_id), ow.base_id, ow.table_id
                ORDER BY sum(ow.request_count) DESC, max(ow.max_duration_ms) DESC
                LIMIT ${limit}
              `.execute(metaDb),
              sql<RecommendationRow>`
                SELECT rec.*
                FROM table_query_recommendation rec
                LEFT JOIN base scope_b ON scope_b.id = rec.base_id
                WHERE true ${scopeSql(input, 'rec')} ${spaceScopeSql(input, 'rec')}
                ORDER BY rec.created_time DESC
                LIMIT ${limit}
              `.execute(metaDb),
              sql<TaskRow>`
                SELECT task.*
                FROM table_query_remediation_task task
                LEFT JOIN base scope_b ON scope_b.id = task.base_id
                WHERE true ${scopeSql(input, 'task')} ${
                  input.spaceId ? sql`AND scope_b.space_id = ${input.spaceId}` : sql``
                }
                ORDER BY task.created_time DESC
                LIMIT ${limit}
              `.execute(metaDb),
            ]);

            const summary = summaryRows.rows[0] ?? {};
            return {
              scope: input,
              summary: {
                enabled: true,
                observationWindowCount: toNumber(summary.observation_window_count),
                requestCount: toNumber(summary.request_count),
                slowCount: toNumber(summary.slow_count),
                timeoutCount: toNumber(summary.timeout_count),
                dbErrorCount: toNumber(summary.db_error_count),
                recommendationCount: toNumber(summary.recommendation_count),
                openRecommendationCount: toNumber(summary.open_recommendation_count),
                acceptedRecommendationCount: toNumber(summary.accepted_recommendation_count),
                taskCount: toNumber(summary.task_count),
                runningTaskCount: toNumber(summary.running_task_count),
                failedTaskCount: toNumber(summary.failed_task_count),
              },
              hotTables: hotTableRows.rows.map((row) => ({
                spaceId: row.space_id,
                baseId: row.base_id,
                tableId: row.table_id,
                requestCount: toNumber(row.request_count),
                slowCount: toNumber(row.slow_count),
                timeoutCount: toNumber(row.timeout_count),
                dbErrorCount: toNumber(row.db_error_count),
                maxDurationMs: toNumber(row.max_duration_ms),
                latestWindowStart: toIsoString(row.latest_window_start),
              })),
              recommendations: {
                total: toNumber(summary.recommendation_count),
                data: recommendationRows.rows.map((row) => ({
                  id: row.id,
                  spaceId: row.space_id,
                  baseId: row.base_id,
                  tableId: row.table_id,
                  shapeHash: row.shape_hash,
                  policyVersion: row.policy_version,
                  status: row.status,
                  riskLevel: row.risk_level,
                  riskScore: row.risk_score,
                  reasonCodes: toStringArray(row.reason_codes),
                  remediationKinds: getRemediationKinds(row.remediation_candidates),
                  queryKind: getQueryKind(row.snapshot),
                  createdTime: toIsoString(row.created_time),
                  lastModifiedTime: toIsoString(row.last_modified_time),
                })),
              },
              tasks: {
                total: toNumber(summary.task_count),
                data: taskRows.rows.map((row) => ({
                  id: row.id,
                  recommendationId: row.recommendation_id,
                  baseId: row.base_id,
                  tableId: row.table_id,
                  kind: row.kind,
                  status: row.status,
                  attempts: row.attempts,
                  maxAttempts: row.max_attempts,
                  lastError: row.last_error,
                  createdTime: toIsoString(row.created_time),
                  lastModifiedTime: toIsoString(row.last_modified_time),
                })),
              },
            };
          },
          catch: (error) => CliError.fromUnknown(error),
        }),

      analyzeSavedViews: (
        input: TableQueryOpsAnalyzeSavedViewsInput
      ): Effect.Effect<TableQueryOpsAnalyzeSavedViewsResult, CliError> =>
        Effect.tryPromise({
          try: () => analyzeSavedViewsUnsafe(input),
          catch: (error) => CliError.fromUnknown(error),
        }),

      executeRecommendations: (
        input: TableQueryOpsExecuteRecommendationsInput
      ): Effect.Effect<TableQueryOpsExecuteRecommendationsResult, CliError> =>
        Effect.tryPromise({
          try: async () => {
            if (!input.tableId) {
              throw new Error('table-query-ops execute-recommendations requires --table-id');
            }
            const analysis = await analyzeSavedViewsUnsafe(input);
            const tableAnalysis = analysis.analyses.find((item) => item.tableId === input.tableId);
            const baseId = tableAnalysis?.baseId;
            const dryRun = !(input.execute ?? false);
            const context = createContext(container);
            const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
            const tableRepository = container.resolve<ITableRepository>(
              v2CoreTokens.tableRepository
            );
            const tableId = TableId.create(input.tableId);
            if (tableId.isErr()) throw tableId.error;
            const tableResult = await tableRepository.findOne(
              context,
              TableByIdSpec.create(tableId.value)
            );
            if (tableResult.isErr()) throw tableResult.error;
            const results: Array<TableQueryOpsExecuteRecommendationsResult['results'][number]> = [];
            const explainResults: ExplainRecommendedIndexResult[] = [];
            for (const recommendedIndex of analysis.recommendedIndexes.slice(
              0,
              input.maxIndexes ?? analysis.recommendedIndexes.length
            )) {
              explainResults.push(
                await explainRecommendedIndex({
                  context,
                  table: tableResult.value,
                  recommendedIndex,
                })
              );
            }
            const { recommendedIndexSet } = buildRecommendedIndexSet(explainResults);
            const validationByKey = new Map(
              explainResults.map((result) => [result.recommendedIndex.indexKey, result])
            );
            const candidates = recommendedIndexSet
              .map((item) => validationByKey.get(item.indexKey)?.recommendedIndex)
              .filter((item): item is TableQueryOpsRecommendedIndexSummary => Boolean(item));
            if (!baseId && candidates.length > 0) {
              throw new Error(`No base id found for table ${input.tableId}`);
            }

            for (const recommendedIndex of candidates) {
              const validation =
                validationByKey.get(recommendedIndex.indexKey) ??
                (await explainRecommendedIndex({
                  context,
                  table: tableResult.value,
                  recommendedIndex,
                }));
              if (validation.nextAction !== 'ready_for_confirmation') {
                results.push({
                  recommendedIndex,
                  action: 'skipped',
                  validation,
                  error: `plan validation did not approve execution: ${validation.explainReason ?? validation.nextAction}`,
                });
                continue;
              }
              if (dryRun) {
                results.push({ recommendedIndex, action: 'dry_run', validation });
                continue;
              }
              try {
                const taskResult = await commandBus.execute(
                  context,
                  new RunTableQueryRecommendedIndexCommand({
                    baseId: baseId ?? '',
                    tableId: input.tableId,
                    kind: remediationKindForRecommendedIndex(recommendedIndex),
                    payload: {
                      indexKey: recommendedIndex.indexKey,
                      indexKind: recommendedIndex.indexKind,
                      indexStructure: recommendedIndex.indexStructure,
                      fields: recommendedIndex.fields,
                    },
                    allowManualIndexExecution: true,
                    workerId: 'teable-devtools:table-query-ops',
                  })
                );
                if (taskResult.isErr()) throw taskResult.error;
                const taskSnapshot = (taskResult.value as TableQueryRemediationTask).snapshot();
                results.push({
                  recommendedIndex,
                  action: taskSnapshot.status === 'succeeded' ? 'executed' : 'failed',
                  validation,
                  task: taskSnapshot,
                  ...(taskSnapshot.lastError ? { error: taskSnapshot.lastError } : {}),
                });
              } catch (error) {
                results.push({
                  recommendedIndex,
                  action: 'failed',
                  validation,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }

            return {
              scope: input,
              dryRun,
              scannedViewCount: analysis.scannedViewCount,
              recommendationCount: analysis.recommendationCount,
              recommendedIndexCount: results.filter(
                (item) => item.validation?.nextAction === 'ready_for_confirmation'
              ).length,
              executedCount: results.filter((item) => item.action === 'executed').length,
              failedCount: results.filter((item) => item.action === 'failed').length,
              skippedCount: results.filter((item) => item.action === 'skipped').length,
              results,
            };
          },
          catch: (error) => CliError.fromUnknown(error),
        }),

      explainSavedViews: (
        input: TableQueryOpsExplainSavedViewsInput
      ): Effect.Effect<TableQueryOpsExplainSavedViewsResult, CliError> =>
        Effect.tryPromise({
          try: async () => {
            if (!input.tableId) {
              throw new Error('table-query-ops explain-saved-views requires --table-id');
            }
            const analysis = await analyzeSavedViewsUnsafe(input);
            const context = createContext(container);
            const tableRepository = container.resolve<ITableRepository>(
              v2CoreTokens.tableRepository
            );
            const tableId = TableId.create(input.tableId);
            if (tableId.isErr()) throw tableId.error;
            const tableResult = await tableRepository.findOne(
              context,
              TableByIdSpec.create(tableId.value)
            );
            if (tableResult.isErr()) throw tableResult.error;
            const recommendations = analysis.recommendedIndexes.slice(0, input.maxIndexes ?? 20);
            const results = [];
            for (const recommendedIndex of recommendations) {
              results.push(
                await explainRecommendedIndex({
                  context,
                  table: tableResult.value,
                  recommendedIndex,
                })
              );
            }
            const { recommendedIndexSet, rejectedCandidates } = buildRecommendedIndexSet(results);
            const coverageReport = buildCoverageReport({
              analyses: analysis.analyses,
              results,
              recommendedIndexSet,
              rejectedCandidates,
            });
            const queryRiskReports = buildQueryRiskReports({
              analyses: analysis.analyses,
              results,
              recommendedIndexSet,
              rejectedCandidates,
            });
            const validatedRecommendations = recommendedIndexSet.flatMap((item) =>
              item.evidence.filter(
                (evidence) => evidence.recommendedIndex.indexKey === item.indexKey
              )
            );
            const manualInvestigationCandidates = rejectedCandidates
              .map((item) => item.evidence)
              .filter((item): item is ExplainRecommendedIndexResult => Boolean(item));
            const skippedSources = coverageReport.sources.filter((source) =>
              source.statuses.includes('skipped')
            );
            return {
              scope: input,
              scannedViewCount: analysis.scannedViewCount,
              parsedViewCount: coverageReport.parsedSourceCount,
              recommendationCount: analysis.recommendationCount,
              candidateIndexCount: analysis.recommendedIndexes.length,
              recommendedIndexCount: recommendedIndexSet.length,
              validatedRecommendationCount: validatedRecommendations.length,
              rejectedCandidateCount: rejectedCandidates.length,
              skippedViewCount: skippedSources.length,
              manualInvestigationCount: rejectedCandidates.filter(
                (item) => item.nextAction === 'manual_investigation'
              ).length,
              explainedIndexCount: results.length,
              recommendedIndexSet,
              queryRiskReports,
              coverageReport,
              rejectedCandidates,
              skippedSources,
              validatedRecommendations,
              manualInvestigationCandidates,
              results,
            };
          },
          catch: (error) => CliError.fromUnknown(error),
        }),

      analyzeObservation: (
        input: TableQueryOpsAnalyzeObservationInput
      ): Effect.Effect<TableQueryOpsAnalyzeObservationResult, CliError> =>
        Effect.tryPromise({
          try: async () => {
            await ensureRegistered(input.ensureSchema ?? true);
            const context = createContext(container);
            const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
            const observation = parseObservationInput(input.observation);

            if (input.recordObservation ?? true) {
              const recorded = await commandBus.execute(
                context,
                new RecordTableQueryObservationCommand(observation)
              );
              if (recorded.isErr()) throw recorded.error;
            }

            const result = await commandBus.execute(
              context,
              new AnalyzeAndRecommendTableQueryCommand(observation)
            );
            if (result.isErr()) throw result.error;
            const value = result.value as AnalyzeAndRecommendTableQueryResult;

            const indexPlan = buildIndexPlanSummary({
              queryKind: observation.shape().queryKind(),
              shapeHash: observation.shapeHash(),
              report: value.report,
            });

            return {
              recorded: input.recordObservation ?? true,
              observation: observation.snapshot(),
              report: value.report.snapshot(),
              indexPlan,
              recommendedIndexes: buildRecommendedIndexes([
                {
                  source: 'observation',
                  indexPlan,
                },
              ]),
              recommendation: value.recommendation?.snapshot(),
            };
          },
          catch: (error) => CliError.fromUnknown(error),
        }),
    };
  })
);
