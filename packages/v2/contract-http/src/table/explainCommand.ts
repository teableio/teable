import { z } from 'zod';

import {
  apiOkResponseDtoSchema,
  apiErrorResponseDtoSchema,
  type HttpErrorStatus,
  type IApiOkResponseDto,
  type IApiErrorResponseDto,
  type IApiResponseDto,
} from '../shared/http';

// Input schemas for explain endpoints
export const explainCreateRecordInputSchema = z.object({
  tableId: z.string(),
  fields: z.record(z.string(), z.unknown()),
  analyze: z.boolean().optional().default(false),
  includeSql: z.boolean().optional().default(true),
  includeGraph: z.boolean().optional().default(false),
  includeLocks: z.boolean().optional().default(true),
});

export const explainUpdateRecordInputSchema = z.object({
  tableId: z.string(),
  recordId: z.string(),
  fields: z.record(z.string(), z.unknown()),
  analyze: z.boolean().optional().default(false),
  includeSql: z.boolean().optional().default(true),
  includeGraph: z.boolean().optional().default(false),
  includeLocks: z.boolean().optional().default(true),
});

export const explainDeleteRecordsInputSchema = z.object({
  tableId: z.string(),
  recordIds: z.array(z.string()),
  analyze: z.boolean().optional().default(false),
  includeSql: z.boolean().optional().default(true),
  includeGraph: z.boolean().optional().default(false),
  includeLocks: z.boolean().optional().default(true),
});

export type IExplainCreateRecordInput = z.infer<typeof explainCreateRecordInputSchema>;
export type IExplainUpdateRecordInput = z.infer<typeof explainUpdateRecordInputSchema>;
export type IExplainDeleteRecordsInput = z.infer<typeof explainDeleteRecordsInputSchema>;

// Response types matching ExplainResult from command-explain

/**
 * PostgreSQL EXPLAIN JSON plan node schema.
 */
const explainPlanNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      'Node Type': z.string(),
      'Parallel Aware': z.boolean().optional(),
      'Async Capable': z.boolean().optional(),
      'Relation Name': z.string().optional(),
      Alias: z.string().optional(),
      'Startup Cost': z.number().optional(),
      'Total Cost': z.number().optional(),
      'Plan Rows': z.number().optional(),
      'Plan Width': z.number().optional(),
      'Actual Startup Time': z.number().optional(),
      'Actual Total Time': z.number().optional(),
      'Actual Rows': z.number().optional(),
      'Actual Loops': z.number().optional(),
      Output: z.array(z.string()).optional(),
      Filter: z.string().optional(),
      'Rows Removed by Filter': z.number().optional(),
      'Join Type': z.string().optional(),
      'Inner Unique': z.boolean().optional(),
      'Hash Cond': z.string().optional(),
      'Index Name': z.string().optional(),
      'Index Cond': z.string().optional(),
      'Scan Direction': z.string().optional(),
      'Shared Hit Blocks': z.number().optional(),
      'Shared Read Blocks': z.number().optional(),
      'Shared Dirtied Blocks': z.number().optional(),
      'Shared Written Blocks': z.number().optional(),
      'Local Hit Blocks': z.number().optional(),
      'Local Read Blocks': z.number().optional(),
      'Local Dirtied Blocks': z.number().optional(),
      'Local Written Blocks': z.number().optional(),
      'Temp Read Blocks': z.number().optional(),
      'Temp Written Blocks': z.number().optional(),
      Plans: z.array(explainPlanNodeSchema).optional(),
    })
    .passthrough()
);

/**
 * PostgreSQL EXPLAIN JSON output structure schema.
 */
const explainJsonOutputSchema = z.object({
  Plan: explainPlanNodeSchema,
  'Planning Time': z.number().optional(),
  'Execution Time': z.number().optional(),
  Triggers: z.array(z.unknown()).optional(),
});

const explainOutputSchema = z.object({
  plan: explainJsonOutputSchema,
  estimatedCost: z.number().optional(),
  estimatedRows: z.number().optional(),
  analyzeError: z.string().optional(),
});

const explainAnalyzeOutputSchema = z.object({
  plan: explainJsonOutputSchema,
  planningTimeMs: z.number().optional(),
  executionTimeMs: z.number().optional(),
  actualRows: z.number().optional(),
  estimatedRows: z.number().optional(),
});

const computedUpdateSeedFieldSchema = z.object({
  fieldId: z.string(),
  fieldName: z.string(),
  fieldType: z.string(),
  tableId: z.string(),
  tableName: z.string(),
  impact: z.enum(['value', 'link_relation']),
});

const computedUpdateDependencySchema = z.object({
  fromFieldId: z.string(),
  fromFieldName: z.string(),
  fromFieldType: z.string(),
  fromTableId: z.string(),
  fromTableName: z.string(),
  kind: z.enum(['same_record', 'cross_record']),
  semantic: z
    .enum([
      'formula_ref',
      'lookup_source',
      'lookup_link',
      'link_title',
      'rollup_source',
      'conditional_rollup_source',
      'conditional_lookup_source',
    ])
    .optional(),
  linkFieldId: z.string().optional(),
  isSeed: z.boolean(),
});

const computedUpdateTargetFieldSchema = z.object({
  fieldId: z.string(),
  fieldName: z.string(),
  fieldType: z.string(),
  tableId: z.string(),
  tableName: z.string(),
  dependencies: z.array(computedUpdateDependencySchema),
});

const computedUpdateReasonSchema = z.object({
  changeType: z.enum(['insert', 'update', 'delete']),
  seedFields: z.array(computedUpdateSeedFieldSchema),
  targetFields: z.array(computedUpdateTargetFieldSchema),
  notes: z.array(z.string()),
});

const sqlExplainInfoSchema = z.object({
  stepDescription: z.string(),
  sql: z.string(),
  parameters: z.array(z.unknown()),
  explainAnalyze: explainAnalyzeOutputSchema.nullable(),
  explainOnly: explainOutputSchema.nullable(),
  explainError: z.string().nullable().optional(),
  computedReason: computedUpdateReasonSchema.optional(),
});

const dependencyEdgeInfoSchema = z.object({
  fromFieldId: z.string(),
  fromFieldName: z.string(),
  fromTableId: z.string(),
  fromTableName: z.string(),
  toFieldId: z.string(),
  toFieldName: z.string(),
  toTableId: z.string(),
  toTableName: z.string(),
  kind: z.enum(['same_record', 'cross_record']),
  linkFieldId: z.string().optional(),
});

const dependencyGraphInfoSchema = z.object({
  fieldCount: z.number(),
  edgeCount: z.number(),
  edges: z.array(dependencyEdgeInfoSchema),
});

const updateStepInfoSchema = z.object({
  level: z.number(),
  tableId: z.string(),
  tableName: z.string(),
  fieldIds: z.array(z.string()),
  fieldNames: z.array(z.string()),
  fieldTypes: z.array(z.string()),
  estimatedRecordCount: z.number(),
  status: z.enum(['ok', 'blocked']).optional(),
  warning: z.string().optional(),
});

const sameTableBatchInfoSchema = z.object({
  tableId: z.string(),
  tableName: z.string(),
  stepCount: z.number(),
  minLevel: z.number(),
  maxLevel: z.number(),
  totalFieldCount: z.number(),
  canOptimize: z.boolean(),
});

const affectedRecordEstimateSchema = z.object({
  tableId: z.string(),
  tableName: z.string(),
  estimatedCount: z.number(),
  source: z.enum(['seed', 'propagation']),
});

const computedImpactInfoSchema = z.object({
  baseId: z.string(),
  seedTableId: z.string(),
  seedRecordCount: z.number(),
  dependencyGraph: dependencyGraphInfoSchema,
  updateSteps: z.array(updateStepInfoSchema),
  sameTableBatches: z.array(sameTableBatchInfoSchema),
  affectedRecordEstimates: z.array(affectedRecordEstimateSchema),
  warnings: z.array(z.string()).optional(),
});

const computedUpdateLockRecordSchema = z.object({
  tableId: z.string(),
  tableName: z.string(),
  recordId: z.string(),
  key: z.string(),
});

const computedUpdateLockTableSchema = z.object({
  tableId: z.string(),
  tableName: z.string(),
  key: z.string(),
});

const computedUpdateLockBatchSchema = z.object({
  tableId: z.string(),
  tableName: z.string(),
  batchId: z.string(),
  recordCount: z.number(),
  key: z.string(),
});

const computedUpdateLockStatementSchema = z.object({
  scope: z.enum(['record', 'batch', 'table']),
  tableId: z.string(),
  tableName: z.string(),
  recordId: z.string().optional(),
  batchId: z.string().optional(),
  key: z.string(),
  sql: z.string(),
  parameters: z.array(z.unknown()),
});

const computedUpdateLockInfoSchema = z.object({
  mode: z.enum(['disabled', 'none', 'record', 'batch', 'table', 'mixed']),
  reason: z.string(),
  maxRecordLocks: z.number(),
  batchShardCount: z.number(),
  seedRecordCount: z.number(),
  recordLockCount: z.number(),
  batchLockCount: z.number(),
  tableLockCount: z.number(),
  tableLockTableIds: z.array(z.string()),
  recordLocks: z.array(computedUpdateLockRecordSchema),
  batchLocks: z.array(computedUpdateLockBatchSchema),
  tableLocks: z.array(computedUpdateLockTableSchema),
  statements: z.array(computedUpdateLockStatementSchema),
});

// Link record locks info - simplified to avoid type complexity issues
const linkRecordLocksInfoSchema = z
  .object({
    mode: z.enum(['none', 'active']),
    reason: z.string(),
    lockCount: z.number(),
    locks: z.array(
      z.object({
        foreignTableId: z.string(),
        foreignTableName: z.string().optional(),
        foreignRecordId: z.string(),
        key: z.string(),
      })
    ),
    sql: z.string().optional(),
    parameters: z.array(z.unknown()).optional(),
  })
  .nullable()
  .optional();

const complexityFactorSchema = z.object({
  name: z.string(),
  value: z.number(),
  contribution: z.number(),
  description: z.string().optional(),
});

const complexityAssessmentSchema = z.object({
  score: z.number(),
  level: z.enum(['trivial', 'low', 'medium', 'high', 'very_high']),
  factors: z.array(complexityFactorSchema),
  recommendations: z.array(z.string()),
});

const commandExplainInfoSchema = z.object({
  type: z.enum(['CreateRecord', 'UpdateRecord', 'DeleteRecords', 'Paste']),
  tableId: z.string(),
  tableName: z.string(),
  recordIds: z.array(z.string()),
  changedFieldIds: z.array(z.string()).optional(),
  changedFieldNames: z.array(z.string()).optional(),
  changedFieldTypes: z.array(z.string()).optional(),
  changeType: z.enum(['insert', 'update', 'delete']),
});

const explainTimingSchema = z.object({
  totalMs: z.number(),
  dependencyGraphMs: z.number(),
  planningMs: z.number(),
  sqlExplainMs: z.number(),
});

export const explainResultSchema = z.object({
  command: commandExplainInfoSchema,
  computedImpact: computedImpactInfoSchema.nullable(),
  computedLocks: computedUpdateLockInfoSchema.nullable().optional(),
  linkLocks: linkRecordLocksInfoSchema,
  sqlExplains: z.array(sqlExplainInfoSchema),
  complexity: complexityAssessmentSchema,
  timing: explainTimingSchema,
});

export type IExplainResultDto = z.infer<typeof explainResultSchema>;

export type IExplainResponseDto = IApiResponseDto<IExplainResultDto>;
export type IExplainOkResponseDto = IApiOkResponseDto<IExplainResultDto>;
export type IExplainErrorResponseDto = IApiErrorResponseDto;

export type IExplainEndpointResult =
  | { status: 200; body: IExplainOkResponseDto }
  | { status: HttpErrorStatus; body: IExplainErrorResponseDto };

export const explainOkResponseSchema = apiOkResponseDtoSchema(explainResultSchema);
export const explainErrorResponseSchema = apiErrorResponseDtoSchema;
