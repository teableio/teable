import type {
  TableQueryOpsIndexNextAction,
  TableQueryObservationWindowSnapshot,
  TableQueryRecommendation,
  TableQueryRiskReport,
} from '@teable/v2-table-query-ops';
import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';

export interface TableQueryOpsScopeInput {
  readonly organizationId?: string;
  readonly spaceId?: string;
  readonly baseId?: string;
  readonly tableId?: string;
}

export interface TableQueryOpsOverviewInput extends TableQueryOpsScopeInput {
  readonly limit?: number;
  readonly ensureSchema?: boolean;
}

export interface TableQueryOpsAnalyzeSavedViewsInput extends TableQueryOpsScopeInput {
  readonly limit?: number;
  readonly ensureSchema?: boolean;
}

export interface TableQueryOpsExecuteRecommendationsInput extends TableQueryOpsScopeInput {
  readonly limit?: number;
  readonly ensureSchema?: boolean;
  readonly execute?: boolean;
  readonly maxIndexes?: number;
}

export interface TableQueryOpsExplainSavedViewsInput extends TableQueryOpsScopeInput {
  readonly limit?: number;
  readonly ensureSchema?: boolean;
  readonly maxIndexes?: number;
}

export interface TableQueryOpsAnalyzeObservationInput {
  readonly observation: unknown;
  readonly recordObservation?: boolean;
  readonly ensureSchema?: boolean;
}

export interface TableQueryOpsSummary {
  readonly enabled: boolean;
  readonly observationWindowCount: number;
  readonly requestCount: number;
  readonly slowCount: number;
  readonly timeoutCount: number;
  readonly dbErrorCount: number;
  readonly recommendationCount: number;
  readonly openRecommendationCount: number;
  readonly acceptedRecommendationCount: number;
  readonly taskCount: number;
  readonly runningTaskCount: number;
  readonly failedTaskCount: number;
}

export interface TableQueryOpsHotTable {
  readonly spaceId: string | null;
  readonly baseId: string;
  readonly tableId: string;
  readonly requestCount: number;
  readonly slowCount: number;
  readonly timeoutCount: number;
  readonly dbErrorCount: number;
  readonly maxDurationMs: number;
  readonly latestWindowStart: string | null;
}

export interface TableQueryOpsRecommendationSummary {
  readonly id: string;
  readonly spaceId: string | null;
  readonly baseId: string;
  readonly tableId: string;
  readonly shapeHash: string;
  readonly policyVersion: string;
  readonly status: string;
  readonly riskLevel: string;
  readonly riskScore: number;
  readonly reasonCodes: readonly string[];
  readonly remediationKinds: readonly string[];
  readonly queryKind?: string;
  readonly createdTime: string | null;
  readonly lastModifiedTime: string | null;
}

export interface TableQueryOpsTaskSummary {
  readonly id: string;
  readonly recommendationId: string | null;
  readonly baseId: string;
  readonly tableId: string;
  readonly kind: string;
  readonly status: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lastError: string | null;
  readonly createdTime: string | null;
  readonly lastModifiedTime: string | null;
}

export interface TableQueryOpsIndexPlanSummary {
  readonly viewId?: string;
  readonly queryKind: string;
  readonly shapeHash: string;
  readonly riskLevel: string;
  readonly riskScore: number;
  readonly reasonCodes: readonly string[];
  readonly candidateIndexes: readonly TableQueryOpsIndexCandidateSummary[];
  readonly shapeSummary: TableQueryOpsQueryRiskShapeSummary;
  readonly physicalStats: { readonly estimatedRows: number };
  readonly indexState: string;
  readonly existingIndexStructures: readonly string[];
  readonly candidateIndexStructures: readonly string[];
  readonly abnormalIndexes: readonly string[];
  readonly explainStatus?: string;
  readonly explainMethod?: string;
  readonly explainReason?: string;
  readonly explainCostBefore?: number;
  readonly explainCostAfter?: number;
  readonly explainCostDelta?: number;
  readonly explainCostDeltaPct?: number;
  readonly explainPlanNodeBefore?: string;
  readonly explainPlanNodeAfter?: string;
  readonly explainUsesCandidateIndex?: boolean;
  readonly hypotheticalIndexStatements: readonly string[];
  readonly nextAction: string;
}

export interface TableQueryOpsQueryRiskShapeSummary {
  readonly filterFields: readonly {
    readonly fieldId: string;
    readonly operatorFamily: string;
    readonly sourceKind?: string;
  }[];
  readonly sortFields: readonly {
    readonly fieldId?: string;
    readonly systemColumn?: string;
    readonly direction: 'asc' | 'desc';
    readonly source: string;
  }[];
  readonly search?: {
    readonly fieldCount: number;
    readonly allFields: boolean;
    readonly valueLengthBucket: string;
  };
  readonly aggregation?: {
    readonly groupFieldCount: number;
    readonly metricCount: number;
    readonly hasFilter: boolean;
  };
  readonly relation?: {
    readonly relationKind: string;
    readonly sourceTableId: string;
    readonly targetTableId: string;
    readonly fieldReferenceCount: number;
    readonly hasTargetFilter: boolean;
    readonly hasTargetSort: boolean;
  };
  readonly formulaFields: readonly TableQueryOpsFormulaEvidenceSummary[];
}

export interface TableQueryOpsIndexFieldSummary {
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

export interface TableQueryOpsFormulaEvidenceSummary {
  readonly formulaFieldId?: string;
  readonly referencedFieldIds: readonly string[];
  readonly functionNames: readonly string[];
  readonly sourceKind?: 'formula_result' | 'formula_source' | 'formula_expression';
  readonly skippedReasons: readonly string[];
  readonly expressionIndexable?: boolean;
  readonly expressionIndexSkippedReasons?: readonly string[];
  readonly predicatePushdown?: {
    readonly supported: boolean;
    readonly operatorFamilies: readonly string[];
    readonly sourceFunctionNames: readonly string[];
    readonly skippedReasons: readonly string[];
  };
}

export interface TableQueryOpsIndexCandidateSummary {
  readonly indexKey: string;
  readonly indexKind: string;
  readonly accessPath: string;
  readonly indexStructure: string;
  readonly fields: readonly TableQueryOpsIndexFieldSummary[];
  readonly reason: string;
}

export interface TableQueryOpsPlanEvidenceSummary {
  readonly source: string;
  readonly queryKind: string;
  readonly shapeHash: string;
  readonly riskLevel: string;
  readonly riskScore: number;
  readonly reasonCodes: readonly string[];
  readonly explainStatus?: string;
  readonly explainMethod?: string;
  readonly explainReason?: string;
  readonly explainCostBefore?: number;
  readonly explainCostAfter?: number;
  readonly explainCostDelta?: number;
  readonly explainCostDeltaPct?: number;
  readonly explainPlanNodeBefore?: string;
  readonly explainPlanNodeAfter?: string;
  readonly explainUsesCandidateIndex?: boolean;
  readonly hypotheticalIndexStatements: readonly string[];
}

export interface TableQueryOpsRecommendedIndexSummary {
  readonly indexKey: string;
  readonly indexKind: string;
  readonly accessPath: string;
  readonly indexStructure: string;
  readonly fields: readonly TableQueryOpsIndexFieldSummary[];
  readonly sourceKind?: 'direct_field' | 'formula_result' | 'formula_source' | 'formula_expression';
  readonly formulaEvidence?: TableQueryOpsFormulaEvidenceSummary;
  readonly optimizedSources: readonly string[];
  readonly optimizedQueryKinds: readonly string[];
  readonly optimizedShapeHashes: readonly string[];
  readonly optimizedFields: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly riskLevels: readonly string[];
  readonly confidence: string;
  readonly planEvidence: readonly TableQueryOpsPlanEvidenceSummary[];
  readonly nextAction: string;
}

export interface TableQueryOpsExecutedRecommendedIndexSummary {
  readonly recommendedIndex: TableQueryOpsRecommendedIndexSummary;
  readonly action: 'dry_run' | 'executed' | 'skipped' | 'failed';
  readonly validation?: TableQueryOpsExplainRecommendedIndexSummary;
  readonly task?: unknown;
  readonly error?: string;
}

export interface TableQueryOpsExplainRecommendedIndexSummary {
  readonly recommendedIndex: TableQueryOpsRecommendedIndexSummary;
  readonly proposedIndexName: string;
  readonly proposedIndexKind: string;
  readonly proposedIndexAccessPath: string;
  readonly proposedIndexFields: readonly TableQueryOpsIndexFieldSummary[];
  readonly sourceKind?: 'direct_field' | 'formula_result' | 'formula_source' | 'formula_expression';
  readonly formulaEvidence?: TableQueryOpsFormulaEvidenceSummary;
  readonly representativeViewId?: string;
  readonly explainStatus: 'validated' | 'skipped' | 'failed';
  readonly explainMethod?: 'explain' | 'hypothetical_index';
  readonly explainReason?: string;
  readonly explainCostBefore?: number;
  readonly explainCostAfter?: number;
  readonly explainCostDelta?: number;
  readonly explainCostDeltaPct?: number;
  readonly explainPlanNodeBefore?: string;
  readonly explainPlanNodeAfter?: string;
  readonly explainUsesCandidateIndex?: boolean;
  readonly hypotheticalIndexStatement?: string;
  readonly nextAction: string;
  readonly error?: string;
}

export type TableQueryOpsSourceCoverageStatus =
  | 'scanned'
  | 'parsed'
  | 'shape_created'
  | 'candidate_generated'
  | 'explain_validated'
  | 'rejected'
  | 'skipped';

export interface TableQueryOpsSourceCoverageSummary {
  readonly sourceType: 'saved_view' | 'relation_field' | 'runtime_observation' | 'manual';
  readonly sourceId: string;
  readonly tableId: string;
  readonly statuses: readonly TableQueryOpsSourceCoverageStatus[];
  readonly shapeHash?: string;
  readonly queryKind?: string;
  readonly candidateIndexKeys: readonly string[];
  readonly recommendedIndexKeys: readonly string[];
  readonly rejectedIndexKeys: readonly string[];
  readonly skippedReason?: string;
  readonly error?: string;
}

export interface TableQueryOpsQueryRiskReportSummary {
  readonly sourceType: 'saved_view' | 'relation_field' | 'runtime_observation' | 'manual';
  readonly sourceId: string;
  readonly sourceName?: string;
  readonly tableId: string;
  readonly queryKind: string;
  readonly shapeHash: string;
  readonly riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  readonly riskScore: number;
  readonly reasonCodes: readonly string[];
  readonly shapeSummary: TableQueryOpsQueryRiskShapeSummary;
  readonly physicalStats: { readonly estimatedRows: number };
  readonly indexInventory: {
    readonly state: string;
    readonly existingIndexStructures: readonly string[];
    readonly candidateIndexStructures: readonly string[];
    readonly abnormalIndexes: readonly string[];
  };
  readonly planEvidence?: {
    readonly explainStatus: 'validated' | 'skipped' | 'failed';
    readonly explainMethod?: 'explain' | 'hypothetical_index';
    readonly explainReason?: string;
    readonly costBefore?: number;
    readonly costAfter?: number;
    readonly costDeltaPct?: number;
    readonly planNodeBefore?: string;
    readonly planNodeAfter?: string;
    readonly usesCandidateIndex?: boolean;
  };
  readonly remediationSummary: {
    readonly hasIndexRecommendation: boolean;
    readonly recommendedIndexKeys: readonly string[];
    readonly rejectedIndexKeys: readonly string[];
    readonly nextAction: TableQueryOpsIndexNextAction;
  };
}

export interface TableQueryOpsCoverageReportSummary {
  readonly scannedSourceCount: number;
  readonly parsedSourceCount: number;
  readonly shapeCreatedSourceCount: number;
  readonly candidateGeneratedSourceCount: number;
  readonly explainValidatedSourceCount: number;
  readonly rejectedSourceCount: number;
  readonly skippedSourceCount: number;
  readonly skippedReasons: Readonly<Record<string, number>>;
  readonly formulaFields: readonly TableQueryOpsFormulaEvidenceSummary[];
  readonly scannedFormulaFieldCount: number;
  readonly validatedFormulaFieldCount: number;
  readonly rejectedFormulaFieldCount: number;
  readonly skippedFormulaFieldCount: number;
  readonly formulaSkippedReasons: Readonly<Record<string, number>>;
  readonly sources: readonly TableQueryOpsSourceCoverageSummary[];
}

export interface TableQueryOpsRecommendedIndexSetSummary {
  readonly indexKey: string;
  readonly indexName: string;
  readonly indexKind: string;
  readonly accessPath: string;
  readonly indexStructure: string;
  readonly fields: readonly TableQueryOpsIndexFieldSummary[];
  readonly sourceKind?: 'direct_field' | 'formula_result' | 'formula_source' | 'formula_expression';
  readonly formulaEvidence?: TableQueryOpsFormulaEvidenceSummary;
  readonly coveredSourceIds: readonly string[];
  readonly coveredViewIds: readonly string[];
  readonly coveredQueryKinds: readonly string[];
  readonly coveredShapeHashes: readonly string[];
  readonly costBefore?: number;
  readonly costAfter?: number;
  readonly costDelta?: number;
  readonly costDeltaPct?: number;
  readonly plannerUsedIndex?: boolean;
  readonly nextAction: TableQueryOpsIndexNextAction;
  readonly coveredCandidateIds: readonly string[];
  readonly rejectedCandidateIds: readonly string[];
  readonly evidence: readonly TableQueryOpsExplainRecommendedIndexSummary[];
}

export interface TableQueryOpsRejectedIndexCandidateSummary {
  readonly indexKey: string;
  readonly indexName: string;
  readonly indexKind: string;
  readonly accessPath: string;
  readonly fields: readonly TableQueryOpsIndexFieldSummary[];
  readonly sourceKind?: 'direct_field' | 'formula_result' | 'formula_source' | 'formula_expression';
  readonly formulaEvidence?: TableQueryOpsFormulaEvidenceSummary;
  readonly coveredSourceIds: readonly string[];
  readonly nextAction: TableQueryOpsIndexNextAction;
  readonly rejectionReason: string;
  readonly coveredByIndexKey?: string;
  readonly evidence?: TableQueryOpsExplainRecommendedIndexSummary;
}

export interface TableQueryOpsOverviewResult {
  readonly scope: TableQueryOpsScopeInput;
  readonly summary: TableQueryOpsSummary;
  readonly hotTables: readonly TableQueryOpsHotTable[];
  readonly recommendations: {
    readonly total: number;
    readonly data: readonly TableQueryOpsRecommendationSummary[];
  };
  readonly tasks: {
    readonly total: number;
    readonly data: readonly TableQueryOpsTaskSummary[];
  };
}

export interface TableQueryOpsSavedViewAnalysis {
  readonly viewId: string;
  readonly spaceId: string | null;
  readonly baseId: string;
  readonly tableId: string;
  readonly shapeHash?: string;
  readonly queryKind?: string;
  readonly report?: ReturnType<TableQueryRiskReport['snapshot']>;
  readonly indexPlan?: TableQueryOpsIndexPlanSummary;
  readonly recommendation?: ReturnType<TableQueryRecommendation['snapshot']>;
  readonly skipped?: string;
  readonly error?: string;
  readonly errorDetails?: unknown;
}

export interface TableQueryOpsAnalyzeSavedViewsResult {
  readonly scope: TableQueryOpsScopeInput;
  readonly scannedViewCount: number;
  readonly observationCount: number;
  readonly recommendationCount: number;
  readonly recommendedIndexes: readonly TableQueryOpsRecommendedIndexSummary[];
  readonly analyses: readonly TableQueryOpsSavedViewAnalysis[];
}

export interface TableQueryOpsAnalyzeObservationResult {
  readonly recorded: boolean;
  readonly observation: TableQueryObservationWindowSnapshot;
  readonly report: ReturnType<TableQueryRiskReport['snapshot']>;
  readonly indexPlan: TableQueryOpsIndexPlanSummary;
  readonly recommendedIndexes: readonly TableQueryOpsRecommendedIndexSummary[];
  readonly recommendation?: ReturnType<TableQueryRecommendation['snapshot']>;
}

export interface TableQueryOpsExecuteRecommendationsResult {
  readonly scope: TableQueryOpsScopeInput;
  readonly dryRun: boolean;
  readonly scannedViewCount: number;
  readonly recommendationCount: number;
  readonly recommendedIndexCount: number;
  readonly executedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly results: readonly TableQueryOpsExecutedRecommendedIndexSummary[];
}

export interface TableQueryOpsExplainSavedViewsResult {
  readonly scope: TableQueryOpsScopeInput;
  readonly scannedViewCount: number;
  readonly parsedViewCount: number;
  readonly recommendationCount: number;
  readonly candidateIndexCount: number;
  readonly recommendedIndexCount: number;
  readonly validatedRecommendationCount: number;
  readonly rejectedCandidateCount: number;
  readonly skippedViewCount: number;
  readonly manualInvestigationCount: number;
  readonly explainedIndexCount: number;
  readonly recommendedIndexSet: readonly TableQueryOpsRecommendedIndexSetSummary[];
  readonly queryRiskReports: readonly TableQueryOpsQueryRiskReportSummary[];
  readonly coverageReport: TableQueryOpsCoverageReportSummary;
  readonly rejectedCandidates: readonly TableQueryOpsRejectedIndexCandidateSummary[];
  readonly skippedSources: readonly TableQueryOpsSourceCoverageSummary[];
  readonly validatedRecommendations: readonly TableQueryOpsExplainRecommendedIndexSummary[];
  readonly manualInvestigationCandidates: readonly TableQueryOpsExplainRecommendedIndexSummary[];
  readonly results: readonly TableQueryOpsExplainRecommendedIndexSummary[];
}

export class TableQueryOps extends Context.Tag('TableQueryOps')<
  TableQueryOps,
  {
    readonly getOverview: (
      input: TableQueryOpsOverviewInput
    ) => Effect.Effect<TableQueryOpsOverviewResult, CliError>;
    readonly analyzeSavedViews: (
      input: TableQueryOpsAnalyzeSavedViewsInput
    ) => Effect.Effect<TableQueryOpsAnalyzeSavedViewsResult, CliError>;
    readonly executeRecommendations: (
      input: TableQueryOpsExecuteRecommendationsInput
    ) => Effect.Effect<TableQueryOpsExecuteRecommendationsResult, CliError>;
    readonly explainSavedViews: (
      input: TableQueryOpsExplainSavedViewsInput
    ) => Effect.Effect<TableQueryOpsExplainSavedViewsResult, CliError>;
    readonly analyzeObservation: (
      input: TableQueryOpsAnalyzeObservationInput
    ) => Effect.Effect<TableQueryOpsAnalyzeObservationResult, CliError>;
  }
>() {}
