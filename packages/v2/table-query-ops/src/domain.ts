import {
  domainError,
  type DomainError,
  type FieldId,
  type Table,
  type TableId,
} from '@teable/v2-core';
import { nanoid } from 'nanoid';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

export const tableQueryKindValues = [
  'recordList',
  'search',
  'filter',
  'sort',
  'group',
  'aggregation',
  'rowCount',
  'searchIndex',
  'relation',
] as const;
export type TableQueryKind = (typeof tableQueryKindValues)[number];

export const tableQueryRiskLevelValues = ['none', 'low', 'medium', 'high', 'critical'] as const;
export type TableQueryRiskLevel = (typeof tableQueryRiskLevelValues)[number];

export const tableQueryRecommendationStatusValues = [
  'open',
  'accepted',
  'dismissed',
  'superseded',
] as const;
export type TableQueryRecommendationStatus = (typeof tableQueryRecommendationStatusValues)[number];

export const tableQueryRemediationKindValues = [
  'create_search_index',
  'create_filter_index',
  'create_sort_index',
  'repair_index',
  'rewrite_query',
  'degrade_query_feature',
  'add_query_cache',
  'add_search_document',
  'add_materialized_counter',
  'manual_investigation',
] as const;
export type TableQueryRemediationKind = (typeof tableQueryRemediationKindValues)[number];

export const executablePhase1RemediationKindValues = [
  'create_search_index',
  'create_filter_index',
  'create_sort_index',
  'repair_index',
  'manual_investigation',
] as const;
export type ExecutablePhase1RemediationKind =
  (typeof executablePhase1RemediationKindValues)[number];

export const tableQueryRemediationTaskStatusValues = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type TableQueryRemediationTaskStatus =
  (typeof tableQueryRemediationTaskStatusValues)[number];

export type SearchValueLengthBucket = 'none' | 'short' | 'medium' | 'long';
export type TableQueryIndexState = 'ready' | 'missing' | 'invalid' | 'unknown';
export type TableQueryIndexKind = 'btree' | 'gin_trgm';
export type TableQueryIndexAccessPath = 'single_field' | 'composite' | 'expression';
export type TableQueryPlanValidationStatus = 'validated' | 'skipped' | 'failed';
export type TableQueryPlanValidationMethod = 'explain' | 'hypothetical_index';

export type TableQueryOperatorFamily =
  | 'text_contains'
  | 'text_prefix'
  | 'equality'
  | 'range'
  | 'empty'
  | 'selection'
  | 'link'
  | 'computed'
  | 'formula_result'
  | 'unknown';

export type TableQueryFormulaAccessPathShape = {
  readonly formulaFieldId: string;
  readonly referencedFieldIds: ReadonlyArray<string>;
  readonly functionNames: ReadonlyArray<string>;
  readonly stable: boolean;
  readonly sourceKind: 'formula_result' | 'formula_source' | 'formula_expression';
  readonly operatorFamilies: ReadonlyArray<string>;
  readonly candidateIndexes: ReadonlyArray<string>;
  readonly skippedReasons: ReadonlyArray<string>;
  readonly expressionIndexable: boolean;
  readonly expressionIndexSkippedReasons: ReadonlyArray<string>;
  readonly predicatePushdown?: {
    readonly supported: boolean;
    readonly operatorFamilies: ReadonlyArray<string>;
    readonly sourceFunctionNames: ReadonlyArray<string>;
    readonly skippedReasons: ReadonlyArray<string>;
  };
  readonly sqlTranslatable?: boolean;
};

export type TableQueryWhereFieldShape = {
  readonly fieldId: string;
  readonly fieldType: string;
  readonly operatorFamily: TableQueryOperatorFamily;
  readonly sourceKind?: 'direct_field' | 'formula_result' | 'formula_source' | 'formula_expression';
  readonly formula?: TableQueryFormulaAccessPathShape;
};

export type TableQueryWhereShape = {
  readonly conditionCount: number;
  readonly andDepth: number;
  readonly orDepth: number;
  readonly fields: ReadonlyArray<TableQueryWhereFieldShape>;
};

export type TableQuerySearchShape = {
  readonly fieldCount: number;
  readonly allFields: boolean;
  readonly valueLengthBucket: SearchValueLengthBucket;
};

export type TableQueryOrderFieldShape = {
  readonly fieldId?: string;
  readonly systemColumn?: string;
  readonly direction: 'asc' | 'desc';
  readonly source: 'sort' | 'group' | 'tieBreaker';
};

export type TableQueryOrderShape = {
  readonly fields: ReadonlyArray<TableQueryOrderFieldShape>;
};

export type TableQueryAggregationShape = {
  readonly groupFieldCount: number;
  readonly metricCount: number;
  readonly hasFilter: boolean;
};

export type TableQueryFanoutShape = {
  readonly companionRequestCount: number;
  readonly rowCountRequests: number;
  readonly aggregationRequests: number;
  readonly searchIndexRequests: number;
};

export type TableQueryRelationKind =
  | 'link'
  | 'lookup'
  | 'conditional_lookup'
  | 'conditional_rollup';

export type TableQueryRelationShape = {
  readonly relationKind: TableQueryRelationKind;
  readonly sourceTableId: string;
  readonly targetTableId: string;
  readonly sourceFieldId?: string;
  readonly targetLookupFieldId?: string;
  readonly fieldReferenceCount: number;
  readonly hasTargetFilter: boolean;
  readonly hasTargetSort: boolean;
  readonly limitBucket?: 'none' | 'small' | 'medium' | 'large';
};

export type TableQueryExecutionShape = {
  readonly durationMs: number;
  readonly dbDurationMs?: number;
  readonly errorKind?: 'timeout' | 'db_error' | 'unknown';
  readonly timedOut: boolean;
  readonly resultCountBucket?: 'none' | 'small' | 'medium' | 'large';
};

export type TableQuerySqlDiagnostic = {
  readonly source: string;
  readonly statementKind: string;
  readonly fingerprint: string;
  readonly parameterCount: number;
  readonly sampled: boolean;
  readonly normalizedSql?: string;
};

export type TableQueryShapeInput = {
  readonly queryKind: TableQueryKind;
  readonly whereShape?: TableQueryWhereShape;
  readonly searchShape?: TableQuerySearchShape;
  readonly orderShape?: TableQueryOrderShape;
  readonly aggregationShape?: TableQueryAggregationShape;
  readonly fanoutShape?: TableQueryFanoutShape;
  readonly relationShape?: TableQueryRelationShape;
  readonly executionShape: TableQueryExecutionShape;
};

const forbiddenLiteralKeys = new Set([
  'value',
  'values',
  'literal',
  'literals',
  'raw',
  'rawValue',
  'searchValue',
  'filterValue',
]);

const containsForbiddenLiteralKey = (input: unknown): boolean => {
  if (input == null || typeof input !== 'object') {
    return false;
  }
  if (Array.isArray(input)) {
    return input.some(containsForbiddenLiteralKey);
  }
  return Object.entries(input as Record<string, unknown>).some(
    ([key, value]) => forbiddenLiteralKeys.has(key) || containsForbiddenLiteralKey(value)
  );
};

const tableQueryShapeSchema: z.ZodType<TableQueryShapeInput> = z.object({
  queryKind: z.enum(tableQueryKindValues),
  whereShape: z
    .object({
      conditionCount: z.number().int().nonnegative(),
      andDepth: z.number().int().nonnegative(),
      orDepth: z.number().int().nonnegative(),
      fields: z.array(
        z.object({
          fieldId: z.string().min(1),
          fieldType: z.string().min(1),
          operatorFamily: z.enum([
            'text_contains',
            'text_prefix',
            'equality',
            'range',
            'empty',
            'selection',
            'link',
            'computed',
            'formula_result',
            'unknown',
          ]),
          sourceKind: z
            .enum(['direct_field', 'formula_result', 'formula_source', 'formula_expression'])
            .optional(),
          formula: z
            .object({
              formulaFieldId: z.string().min(1),
              referencedFieldIds: z.array(z.string().min(1)),
              functionNames: z.array(z.string().min(1)),
              stable: z.boolean(),
              sourceKind: z.enum(['formula_result', 'formula_source', 'formula_expression']),
              operatorFamilies: z.array(z.string().min(1)),
              candidateIndexes: z.array(z.string().min(1)),
              skippedReasons: z.array(z.string().min(1)),
              expressionIndexable: z.boolean(),
              expressionIndexSkippedReasons: z.array(z.string().min(1)),
              predicatePushdown: z
                .object({
                  supported: z.boolean(),
                  operatorFamilies: z.array(z.string().min(1)),
                  sourceFunctionNames: z.array(z.string().min(1)),
                  skippedReasons: z.array(z.string().min(1)),
                })
                .optional(),
              sqlTranslatable: z.boolean().optional(),
            })
            .optional(),
        })
      ),
    })
    .optional(),
  searchShape: z
    .object({
      fieldCount: z.number().int().nonnegative(),
      allFields: z.boolean(),
      valueLengthBucket: z.enum(['none', 'short', 'medium', 'long']),
    })
    .optional(),
  orderShape: z
    .object({
      fields: z.array(
        z.object({
          fieldId: z.string().min(1).optional(),
          systemColumn: z.string().min(1).optional(),
          direction: z.enum(['asc', 'desc']),
          source: z.enum(['sort', 'group', 'tieBreaker']),
        })
      ),
    })
    .optional(),
  aggregationShape: z
    .object({
      groupFieldCount: z.number().int().nonnegative(),
      metricCount: z.number().int().nonnegative(),
      hasFilter: z.boolean(),
    })
    .optional(),
  fanoutShape: z
    .object({
      companionRequestCount: z.number().int().nonnegative(),
      rowCountRequests: z.number().int().nonnegative(),
      aggregationRequests: z.number().int().nonnegative(),
      searchIndexRequests: z.number().int().nonnegative(),
    })
    .optional(),
  relationShape: z
    .object({
      relationKind: z.enum(['link', 'lookup', 'conditional_lookup', 'conditional_rollup']),
      sourceTableId: z.string().min(1),
      targetTableId: z.string().min(1),
      sourceFieldId: z.string().min(1).optional(),
      targetLookupFieldId: z.string().min(1).optional(),
      fieldReferenceCount: z.number().int().nonnegative(),
      hasTargetFilter: z.boolean(),
      hasTargetSort: z.boolean(),
      limitBucket: z.enum(['none', 'small', 'medium', 'large']).optional(),
    })
    .optional(),
  executionShape: z.object({
    durationMs: z.number().nonnegative(),
    dbDurationMs: z.number().nonnegative().optional(),
    errorKind: z.enum(['timeout', 'db_error', 'unknown']).optional(),
    timedOut: z.boolean(),
    resultCountBucket: z.enum(['none', 'small', 'medium', 'large']).optional(),
  }),
});

export class TableQueryShape {
  private constructor(private readonly value: TableQueryShapeInput) {}

  static create(raw: unknown): Result<TableQueryShape, DomainError> {
    if (containsForbiddenLiteralKey(raw)) {
      return err(
        domainError.validation({
          code: 'table_query_ops.shape_contains_literal',
          message: 'Table query shape must not contain raw query literals',
        })
      );
    }
    const parsed = tableQueryShapeSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          code: 'table_query_ops.invalid_shape',
          message: 'Invalid table query shape',
          details: { issues: parsed.error.issues },
        })
      );
    }
    return ok(new TableQueryShape(parsed.data));
  }

  queryKind(): TableQueryKind {
    return this.value.queryKind;
  }

  snapshot(): TableQueryShapeInput {
    return this.value;
  }

  shapeHash(): string {
    return stableHash(this.value);
  }
}

export type TableQueryObservationWindowInput = {
  readonly spaceId?: string;
  readonly baseId: string;
  readonly tableId: string;
  readonly windowStart: Date;
  readonly windowSizeSeconds: number;
  readonly shapeHash?: string;
  readonly shape: TableQueryShape;
  readonly requestCount: number;
  readonly slowCount: number;
  readonly timeoutCount: number;
  readonly dbErrorCount: number;
  readonly totalDurationMs: number;
  readonly maxDurationMs: number;
  readonly totalDbDurationMs?: number;
  readonly maxDbDurationMs?: number;
  readonly sqlDiagnostics?: ReadonlyArray<TableQuerySqlDiagnostic>;
};

export type TableQueryObservationWindowSnapshot = Omit<
  TableQueryObservationWindowInput,
  'shape'
> & {
  readonly shape: TableQueryShapeInput;
  readonly shapeHash: string;
};

const observationWindowSchema = z.object({
  spaceId: z.string().optional(),
  baseId: z.string().min(1),
  tableId: z.string().min(1),
  windowStart: z.date(),
  windowSizeSeconds: z.number().int().positive(),
  shapeHash: z.string().min(1).optional(),
  requestCount: z.number().int().positive(),
  slowCount: z.number().int().nonnegative(),
  timeoutCount: z.number().int().nonnegative(),
  dbErrorCount: z.number().int().nonnegative(),
  totalDurationMs: z.number().nonnegative(),
  maxDurationMs: z.number().nonnegative(),
  totalDbDurationMs: z.number().nonnegative().optional(),
  maxDbDurationMs: z.number().nonnegative().optional(),
  sqlDiagnostics: z
    .array(
      z.object({
        source: z.string().min(1),
        statementKind: z.string().min(1),
        fingerprint: z.string().min(1),
        parameterCount: z.number().int().nonnegative(),
        sampled: z.boolean(),
        normalizedSql: z.string().min(1).max(4000).optional(),
      })
    )
    .max(8)
    .optional(),
});

export class TableQueryObservationWindow {
  private constructor(private readonly props: TableQueryObservationWindowInput) {}

  static create(
    raw: TableQueryObservationWindowInput
  ): Result<TableQueryObservationWindow, DomainError> {
    const parsed = observationWindowSchema.safeParse({
      ...raw,
      shape: undefined,
      shapeHash: raw.shapeHash ?? raw.shape.shapeHash(),
    });
    if (!parsed.success) {
      return err(
        domainError.validation({
          code: 'table_query_ops.invalid_observation_window',
          message: 'Invalid table query observation window',
          details: { issues: parsed.error.issues },
        })
      );
    }
    if (raw.slowCount > raw.requestCount || raw.timeoutCount > raw.requestCount) {
      return err(
        domainError.invariant({
          code: 'table_query_ops.invalid_observation_counts',
          message: 'Observation counts cannot exceed request count',
        })
      );
    }
    return ok(
      new TableQueryObservationWindow({ ...raw, shapeHash: raw.shapeHash ?? raw.shape.shapeHash() })
    );
  }

  baseId(): string {
    return this.props.baseId;
  }

  tableId(): string {
    return this.props.tableId;
  }

  shapeHash(): string {
    return this.props.shapeHash ?? this.props.shape.shapeHash();
  }

  shape(): TableQueryShape {
    return this.props.shape;
  }

  requestCount(): number {
    return this.props.requestCount;
  }

  slowCount(): number {
    return this.props.slowCount;
  }

  timeoutCount(): number {
    return this.props.timeoutCount;
  }

  dbErrorCount(): number {
    return this.props.dbErrorCount;
  }

  maxDurationMs(): number {
    return this.props.maxDurationMs;
  }

  snapshot(): TableQueryObservationWindowSnapshot {
    return { ...this.props, shape: this.props.shape.snapshot(), shapeHash: this.shapeHash() };
  }
}

export type TablePhysicalStatsInput = {
  readonly estimatedRows: number;
  readonly totalBytes: number;
  readonly seqScanCount?: number;
  readonly indexScanCount?: number;
  readonly lastAnalyzeAt?: Date;
};

export class TablePhysicalStats {
  private constructor(private readonly props: TablePhysicalStatsInput) {}

  static create(raw: TablePhysicalStatsInput): Result<TablePhysicalStats, DomainError> {
    const parsed = z
      .object({
        estimatedRows: z.number().nonnegative(),
        totalBytes: z.number().nonnegative(),
        seqScanCount: z.number().nonnegative().optional(),
        indexScanCount: z.number().nonnegative().optional(),
        lastAnalyzeAt: z.date().optional(),
      })
      .safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid table physical stats' }));
    }
    return ok(new TablePhysicalStats(parsed.data));
  }

  estimatedRows(): number {
    return this.props.estimatedRows;
  }

  snapshot(): TablePhysicalStatsInput {
    return this.props;
  }
}

export type TableQueryIndexInspectionInput = {
  readonly state: TableQueryIndexState;
  readonly usefulIndexes: ReadonlyArray<{
    readonly fieldId?: string;
    readonly fieldDbName?: string;
    readonly fields?: ReadonlyArray<TableQueryIndexField>;
    readonly kind: TableQueryIndexKind;
    readonly accessPath?: TableQueryIndexAccessPath;
    readonly valid: boolean;
    readonly name?: string;
  }>;
  readonly missingIndexCandidates: ReadonlyArray<{
    readonly fieldId?: string;
    readonly fieldDbName?: string;
    readonly fields?: ReadonlyArray<TableQueryIndexField>;
    readonly kind: TableQueryIndexKind;
    readonly accessPath?: TableQueryIndexAccessPath;
    readonly reason: string;
  }>;
  readonly abnormalIndexes: ReadonlyArray<{
    readonly name: string;
    readonly reason: string;
  }>;
};

export type TableQueryIndexField = {
  readonly fieldId?: string;
  readonly fieldDbName?: string;
  readonly direction?: 'asc' | 'desc';
  readonly role?:
    | 'filter'
    | 'sort'
    | 'group'
    | 'search'
    | 'formula_result'
    | 'formula_source'
    | 'formula_expression';
  readonly sourceKind?: 'direct_field' | 'formula_result' | 'formula_source' | 'formula_expression';
  readonly formulaFieldId?: string;
  readonly formulaFunctionNames?: ReadonlyArray<string>;
  readonly formulaSkippedReasons?: ReadonlyArray<string>;
  readonly formulaPredicatePushdown?: {
    readonly supported: boolean;
    readonly operatorFamilies: ReadonlyArray<string>;
    readonly sourceFunctionNames: ReadonlyArray<string>;
    readonly skippedReasons: ReadonlyArray<string>;
  };
};

const tableQueryIndexFieldSchema = z.object({
  fieldId: z.string().optional(),
  fieldDbName: z.string().optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  role: z
    .enum([
      'filter',
      'sort',
      'group',
      'search',
      'formula_result',
      'formula_source',
      'formula_expression',
    ])
    .optional(),
  sourceKind: z
    .enum(['direct_field', 'formula_result', 'formula_source', 'formula_expression'])
    .optional(),
  formulaFieldId: z.string().optional(),
  formulaFunctionNames: z.array(z.string().min(1)).optional(),
  formulaSkippedReasons: z.array(z.string().min(1)).optional(),
  formulaPredicatePushdown: z
    .object({
      supported: z.boolean(),
      operatorFamilies: z.array(z.string().min(1)),
      sourceFunctionNames: z.array(z.string().min(1)),
      skippedReasons: z.array(z.string().min(1)),
    })
    .optional(),
});

export class TableQueryIndexInspection {
  private constructor(private readonly props: TableQueryIndexInspectionInput) {}

  static create(
    raw: TableQueryIndexInspectionInput
  ): Result<TableQueryIndexInspection, DomainError> {
    const parsed = z
      .object({
        state: z.enum(['ready', 'missing', 'invalid', 'unknown']),
        usefulIndexes: z.array(
          z.object({
            fieldId: z.string().optional(),
            fieldDbName: z.string().optional(),
            fields: z.array(tableQueryIndexFieldSchema).optional(),
            kind: z.enum(['btree', 'gin_trgm']),
            accessPath: z.enum(['single_field', 'composite', 'expression']).optional(),
            valid: z.boolean(),
            name: z.string().optional(),
          })
        ),
        missingIndexCandidates: z.array(
          z.object({
            fieldId: z.string().optional(),
            fieldDbName: z.string().optional(),
            fields: z.array(tableQueryIndexFieldSchema).optional(),
            kind: z.enum(['btree', 'gin_trgm']),
            accessPath: z.enum(['single_field', 'composite', 'expression']).optional(),
            reason: z.string(),
          })
        ),
        abnormalIndexes: z.array(z.object({ name: z.string(), reason: z.string() })),
      })
      .safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid table query index inspection' }));
    }
    return ok(new TableQueryIndexInspection(parsed.data));
  }

  hasMissingUsefulIndex(): boolean {
    return this.props.missingIndexCandidates.length > 0;
  }

  hasAbnormalIndex(): boolean {
    return this.props.abnormalIndexes.length > 0 || this.props.state === 'invalid';
  }

  snapshot(): TableQueryIndexInspectionInput {
    return this.props;
  }
}

export type TableQueryPlanValidationInput = {
  readonly status: TableQueryPlanValidationStatus;
  readonly method?: TableQueryPlanValidationMethod;
  readonly reason?: string;
  readonly candidateCount: number;
  readonly startupCostBefore?: number;
  readonly startupCostAfter?: number;
  readonly totalCostBefore?: number;
  readonly totalCostAfter?: number;
  readonly planNodeBefore?: string;
  readonly planNodeAfter?: string;
  readonly usesCandidateIndex?: boolean;
  readonly indexStatements?: ReadonlyArray<string>;
  readonly errors?: ReadonlyArray<string>;
};

export class TableQueryPlanValidation {
  private constructor(private readonly props: TableQueryPlanValidationInput) {}

  static create(raw: TableQueryPlanValidationInput): Result<TableQueryPlanValidation, DomainError> {
    const parsed = z
      .object({
        status: z.enum(['validated', 'skipped', 'failed']),
        method: z.enum(['explain', 'hypothetical_index']).optional(),
        reason: z.string().min(1).optional(),
        candidateCount: z.number().int().nonnegative(),
        startupCostBefore: z.number().nonnegative().optional(),
        startupCostAfter: z.number().nonnegative().optional(),
        totalCostBefore: z.number().nonnegative().optional(),
        totalCostAfter: z.number().nonnegative().optional(),
        planNodeBefore: z.string().min(1).optional(),
        planNodeAfter: z.string().min(1).optional(),
        usesCandidateIndex: z.boolean().optional(),
        indexStatements: z.array(z.string().min(1)).optional(),
        errors: z.array(z.string().min(1)).optional(),
      })
      .safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid table query plan validation' }));
    }
    return ok(new TableQueryPlanValidation(parsed.data));
  }

  status(): TableQueryPlanValidationStatus {
    return this.props.status;
  }

  supportsAutoExecution(): boolean {
    if (this.props.status !== 'validated') return false;
    if (this.props.usesCandidateIndex === false) return false;
    const before = this.props.totalCostBefore;
    const after = this.props.totalCostAfter;
    return typeof before === 'number' && typeof after === 'number' && after < before;
  }

  snapshot(): TableQueryPlanValidationInput {
    return this.props;
  }
}

export type TableQueryRiskPolicyConfig = {
  readonly slowThresholdMs: number;
  readonly criticalThresholdMs: number;
  readonly minRequestsPerWindow: number;
  readonly highRiskTimeouts: number;
  readonly largeTableEstimatedRows: number;
  readonly wideSearchFields: number;
  readonly aggregationFanoutRequests: number;
  readonly policyVersion: string;
};

export const defaultTableQueryRiskPolicyConfig: TableQueryRiskPolicyConfig = {
  slowThresholdMs: 3000,
  criticalThresholdMs: 10000,
  minRequestsPerWindow: 5,
  highRiskTimeouts: 3,
  largeTableEstimatedRows: 50000,
  wideSearchFields: 30,
  aggregationFanoutRequests: 3,
  policyVersion: 'table-query-risk-v1',
};

export type TableQueryRiskReasonCode =
  | 'high_latency'
  | 'critical_latency'
  | 'timeout_burst'
  | 'large_table'
  | 'wide_search'
  | 'expensive_filter'
  | 'expensive_sort'
  | 'aggregation_fanout'
  | 'missing_useful_index'
  | 'abnormal_index';

export type TableQueryRemediationCandidate = {
  readonly kind: TableQueryRemediationKind;
  readonly fieldId?: string;
  readonly fieldDbName?: string;
  readonly fields?: ReadonlyArray<TableQueryIndexField>;
  readonly indexKind?: TableQueryIndexKind;
  readonly accessPath?: TableQueryIndexAccessPath;
  readonly reason: string;
  readonly executableInPhase1: boolean;
};

export type TableQueryRiskReportInput = {
  readonly policyVersion: string;
  readonly level: TableQueryRiskLevel;
  readonly score: number;
  readonly reasonCodes: ReadonlyArray<TableQueryRiskReasonCode>;
  readonly remediationCandidates: ReadonlyArray<TableQueryRemediationCandidate>;
  readonly observation: TableQueryObservationWindow;
  readonly physicalStats: TablePhysicalStats;
  readonly indexInspection: TableQueryIndexInspection;
  readonly planValidation?: TableQueryPlanValidation;
};

export class TableQueryRiskReport {
  private constructor(private readonly props: TableQueryRiskReportInput) {}

  static create(raw: TableQueryRiskReportInput): Result<TableQueryRiskReport, DomainError> {
    if (raw.score < 0 || raw.score > 100) {
      return err(domainError.validation({ message: 'Risk score must be between 0 and 100' }));
    }
    return ok(new TableQueryRiskReport(raw));
  }

  level(): TableQueryRiskLevel {
    return this.props.level;
  }

  score(): number {
    return this.props.score;
  }

  shouldRecommend(): boolean {
    return this.props.level !== 'none' && this.props.level !== 'low';
  }

  snapshot() {
    return {
      policyVersion: this.props.policyVersion,
      level: this.props.level,
      score: this.props.score,
      reasonCodes: this.props.reasonCodes,
      remediationCandidates: this.props.remediationCandidates,
      observation: this.props.observation.snapshot(),
      physicalStats: this.props.physicalStats.snapshot(),
      indexInspection: this.props.indexInspection.snapshot(),
      planValidation: this.props.planValidation?.snapshot(),
    };
  }
}

export class TableQueryRiskPolicy {
  constructor(
    private readonly config: TableQueryRiskPolicyConfig = defaultTableQueryRiskPolicyConfig
  ) {}

  evaluate(input: {
    readonly observation: TableQueryObservationWindow;
    readonly physicalStats: TablePhysicalStats;
    readonly indexInspection: TableQueryIndexInspection;
    readonly planValidation?: TableQueryPlanValidation;
  }): Result<TableQueryRiskReport, DomainError> {
    const shape = input.observation.shape().snapshot();
    const sortFieldCount =
      shape.orderShape?.fields.filter((field) => field.source !== 'tieBreaker').length ?? 0;
    const matchedRules = [
      riskRule(
        input.observation.maxDurationMs() >= this.config.criticalThresholdMs,
        'critical_latency',
        30
      ),
      riskRule(
        input.observation.maxDurationMs() < this.config.criticalThresholdMs &&
          input.observation.maxDurationMs() >= this.config.slowThresholdMs,
        'high_latency',
        15
      ),
      riskRule(
        input.observation.timeoutCount() >= this.config.highRiskTimeouts,
        'timeout_burst',
        25
      ),
      riskRule(
        input.physicalStats.estimatedRows() >= this.config.largeTableEstimatedRows,
        'large_table',
        15
      ),
      riskRule(
        (shape.searchShape?.fieldCount ?? 0) >= this.config.wideSearchFields,
        'wide_search',
        15
      ),
      riskRule(
        (shape.whereShape?.conditionCount ?? 0) >= 2 && input.observation.slowCount() > 0,
        'expensive_filter',
        10
      ),
      riskRule(sortFieldCount > 0 && input.observation.slowCount() > 0, 'expensive_sort', 10),
      riskRule(
        (shape.fanoutShape?.companionRequestCount ?? 0) >= this.config.aggregationFanoutRequests,
        'aggregation_fanout',
        10
      ),
      riskRule(input.indexInspection.hasMissingUsefulIndex(), 'missing_useful_index', 20),
      riskRule(input.indexInspection.hasAbnormalIndex(), 'abnormal_index', 20),
    ].filter((rule): rule is TableQueryRiskRule => rule != null);
    const reasons = matchedRules.map((rule) => rule.reason);
    const score = matchedRules.reduce((sum, rule) => sum + rule.score, 0);

    const cappedScore = Math.min(100, score);
    const level = riskLevelFromScore(cappedScore);
    return TableQueryRiskReport.create({
      policyVersion: this.config.policyVersion,
      level,
      score: cappedScore,
      reasonCodes: Array.from(new Set(reasons)),
      remediationCandidates: buildRemediationCandidates(shape, input.indexInspection),
      ...input,
    });
  }
}

type TableQueryRiskRule = {
  readonly reason: TableQueryRiskReasonCode;
  readonly score: number;
};

const riskRule = (
  matched: boolean,
  reason: TableQueryRiskReasonCode,
  score: number
): TableQueryRiskRule | undefined => (matched ? { reason, score } : undefined);

export class TableQueryRecommendation {
  private constructor(
    private readonly props: {
      readonly id: string;
      readonly tableId: string;
      readonly baseId: string;
      readonly spaceId?: string;
      readonly shapeHash: string;
      readonly policyVersion: string;
      readonly status: TableQueryRecommendationStatus;
      readonly riskLevel: TableQueryRiskLevel;
      readonly riskScore: number;
      readonly reasonCodes: ReadonlyArray<TableQueryRiskReasonCode>;
      readonly remediationCandidates: ReadonlyArray<TableQueryRemediationCandidate>;
      readonly snapshot: unknown;
      readonly createdTime: Date;
      readonly lastModifiedTime?: Date;
    }
  ) {}

  static createOpen(input: {
    readonly observation: TableQueryObservationWindow;
    readonly report: TableQueryRiskReport;
    readonly now: Date;
  }): Result<TableQueryRecommendation, DomainError> {
    const report = input.report.snapshot();
    return ok(
      new TableQueryRecommendation({
        id: `tqr_${nanoid(16)}`,
        tableId: input.observation.tableId(),
        baseId: input.observation.baseId(),
        spaceId: input.observation.snapshot().spaceId,
        shapeHash: input.observation.shapeHash(),
        policyVersion: report.policyVersion,
        status: 'open',
        riskLevel: report.level,
        riskScore: report.score,
        reasonCodes: report.reasonCodes,
        remediationCandidates: report.remediationCandidates,
        snapshot: report,
        createdTime: input.now,
      })
    );
  }

  static rehydrate(
    input: ReturnType<TableQueryRecommendation['snapshot']>
  ): Result<TableQueryRecommendation, DomainError> {
    return ok(new TableQueryRecommendation(input));
  }

  accept(now: Date): Result<TableQueryRecommendation, DomainError> {
    if (this.props.status !== 'open') {
      return err(domainError.conflict({ message: 'Only open recommendations can be accepted' }));
    }
    return ok(
      new TableQueryRecommendation({ ...this.props, status: 'accepted', lastModifiedTime: now })
    );
  }

  dismiss(now: Date): Result<TableQueryRecommendation, DomainError> {
    if (this.props.status !== 'open') {
      return err(domainError.conflict({ message: 'Only open recommendations can be dismissed' }));
    }
    return ok(
      new TableQueryRecommendation({ ...this.props, status: 'dismissed', lastModifiedTime: now })
    );
  }

  snapshot() {
    return this.props;
  }
}

export class TableQueryRemediationTask {
  private constructor(
    private readonly props: {
      readonly id: string;
      readonly recommendationId?: string;
      readonly tableId: string;
      readonly baseId: string;
      readonly kind: ExecutablePhase1RemediationKind;
      readonly status: TableQueryRemediationTaskStatus;
      readonly payload: unknown;
      readonly result?: unknown;
      readonly attempts: number;
      readonly maxAttempts: number;
      readonly lockedAt?: Date;
      readonly lockedBy?: string;
      readonly lastError?: string;
      readonly createdTime: Date;
      readonly lastModifiedTime?: Date;
    }
  ) {}

  static createQueued(input: {
    readonly recommendation?: TableQueryRecommendation;
    readonly tableId: string;
    readonly baseId: string;
    readonly kind: ExecutablePhase1RemediationKind;
    readonly payload: unknown;
    readonly now: Date;
  }): Result<TableQueryRemediationTask, DomainError> {
    return ok(
      new TableQueryRemediationTask({
        id: `tqt_${nanoid(16)}`,
        recommendationId: input.recommendation?.snapshot().id,
        tableId: input.tableId,
        baseId: input.baseId,
        kind: input.kind,
        status: 'queued',
        payload: input.payload,
        attempts: 0,
        maxAttempts: 3,
        createdTime: input.now,
      })
    );
  }

  static rehydrate(
    input: ReturnType<TableQueryRemediationTask['snapshot']>
  ): Result<TableQueryRemediationTask, DomainError> {
    return ok(new TableQueryRemediationTask(input));
  }

  start(workerId: string, now: Date): Result<TableQueryRemediationTask, DomainError> {
    if (this.props.status !== 'queued' && this.props.status !== 'failed') {
      return err(domainError.conflict({ message: 'Only queued or failed tasks can start' }));
    }
    return ok(
      new TableQueryRemediationTask({
        ...this.props,
        status: 'running',
        attempts: this.props.attempts + 1,
        lockedBy: workerId,
        lockedAt: now,
        lastModifiedTime: now,
      })
    );
  }

  succeed(result: unknown, now: Date): Result<TableQueryRemediationTask, DomainError> {
    if (this.props.status !== 'running') {
      return err(domainError.conflict({ message: 'Only running tasks can succeed' }));
    }
    return ok(
      new TableQueryRemediationTask({
        ...this.props,
        status: 'succeeded',
        result,
        lastModifiedTime: now,
      })
    );
  }

  fail(errorMessage: string, now: Date): Result<TableQueryRemediationTask, DomainError> {
    if (this.props.status !== 'running') {
      return err(domainError.conflict({ message: 'Only running tasks can fail' }));
    }
    return ok(
      new TableQueryRemediationTask({
        ...this.props,
        status: 'failed',
        lastError: errorMessage,
        lastModifiedTime: now,
      })
    );
  }

  snapshot() {
    return this.props;
  }
}

export type QueryShapeBuildInput = {
  readonly table: Table;
  readonly queryKind: TableQueryKind;
  readonly fieldIds?: ReadonlyArray<FieldId>;
  readonly search?: { readonly fieldIds?: ReadonlyArray<FieldId>; readonly valueLength?: number };
  readonly orderBy?: ReadonlyArray<{
    readonly fieldId?: FieldId;
    readonly column?: string;
    readonly direction: 'asc' | 'desc';
    readonly source?: 'sort' | 'group' | 'tieBreaker';
  }>;
  readonly whereShape?: Omit<TableQueryWhereShape, 'fields'> & {
    readonly fields: ReadonlyArray<{
      readonly fieldId: FieldId;
      readonly operatorFamily: TableQueryOperatorFamily;
      readonly sourceKind?: TableQueryWhereFieldShape['sourceKind'];
      readonly formula?: TableQueryFormulaAccessPathShape;
    }>;
  };
  readonly aggregationShape?: TableQueryAggregationShape;
  readonly fanoutShape?: TableQueryFanoutShape;
  readonly relationShape?: TableQueryRelationShape;
  readonly executionShape: TableQueryExecutionShape;
};

export class TableQueryShapeFactory {
  static fromQuery(input: QueryShapeBuildInput): Result<TableQueryShape, DomainError> {
    const fieldById = new Map(
      input.table.getFields().map((field) => [field.id().toString(), field])
    );
    const whereShape = input.whereShape
      ? {
          ...input.whereShape,
          fields: input.whereShape.fields.map((field) => {
            const domainField = fieldById.get(field.fieldId.toString());
            return {
              fieldId: field.fieldId.toString(),
              fieldType: domainField?.type().toString() ?? 'unknown',
              operatorFamily: field.operatorFamily,
              ...(field.sourceKind ? { sourceKind: field.sourceKind } : {}),
              ...(field.formula ? { formula: field.formula } : {}),
            };
          }),
        }
      : undefined;
    return TableQueryShape.create({
      queryKind: input.queryKind,
      whereShape,
      searchShape: input.search
        ? {
            fieldCount: input.search.fieldIds?.length ?? input.table.getFields().length,
            allFields: !input.search.fieldIds?.length,
            valueLengthBucket: bucketSearchValueLength(input.search.valueLength ?? 0),
          }
        : undefined,
      orderShape: input.orderBy
        ? {
            fields: input.orderBy.map((item) => ({
              fieldId: item.fieldId?.toString(),
              systemColumn: item.column,
              direction: item.direction,
              source: item.source ?? (item.column?.startsWith('__') ? 'tieBreaker' : 'sort'),
            })),
          }
        : undefined,
      aggregationShape: input.aggregationShape,
      fanoutShape: input.fanoutShape,
      relationShape: input.relationShape,
      executionShape: input.executionShape,
    });
  }
}

const bucketSearchValueLength = (length: number): SearchValueLengthBucket => {
  if (length <= 0) return 'none';
  if (length <= 8) return 'short';
  if (length <= 64) return 'medium';
  return 'long';
};

const riskLevelFromScore = (score: number): TableQueryRiskLevel => {
  if (score >= 85) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  if (score > 0) return 'low';
  return 'none';
};

const buildRemediationCandidates = (
  shape: TableQueryShapeInput,
  inspection: TableQueryIndexInspection
): ReadonlyArray<TableQueryRemediationCandidate> => {
  const candidates: TableQueryRemediationCandidate[] = [];
  for (const missing of inspection.snapshot().missingIndexCandidates) {
    const kind: ExecutablePhase1RemediationKind =
      missing.kind === 'gin_trgm'
        ? 'create_search_index'
        : shape.orderShape?.fields.some((field) => field.fieldId === missing.fieldId)
          ? 'create_sort_index'
          : 'create_filter_index';
    candidates.push({
      kind,
      fieldId: missing.fieldId,
      fieldDbName: missing.fieldDbName,
      indexKind: missing.kind,
      ...(missing.fields ? { fields: missing.fields } : {}),
      ...(missing.accessPath ? { accessPath: missing.accessPath } : {}),
      reason: missing.reason,
      executableInPhase1: true,
    });
  }
  if (inspection.hasAbnormalIndex()) {
    candidates.push({
      kind: 'repair_index',
      reason: 'One or more query indexes are invalid or abnormal',
      executableInPhase1: true,
    });
  }
  if (candidates.length === 0) {
    candidates.push({
      kind: 'manual_investigation',
      reason: 'Query is risky but no conservative table access-path candidate was found',
      executableInPhase1: true,
    });
  }
  return candidates;
};

export const stableHash = (input: unknown): string => {
  const sorted = JSON.stringify(sortDeep(input));
  let hash = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    hash = (hash * 31 + sorted.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const sortDeep = (input: unknown): unknown => {
  if (Array.isArray(input)) {
    return input.map(sortDeep);
  }
  if (input != null && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, sortDeep(value)])
    );
  }
  return input;
};

export type TableQueryRiskAnalysisTarget = {
  readonly tableId: TableId;
  readonly table?: Table;
};
