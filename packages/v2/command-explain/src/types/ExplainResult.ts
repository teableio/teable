/**
 * Types for command explain results.
 */

/**
 * Information about the command being explained.
 */
export type CommandExplainInfo = {
  readonly type: 'CreateRecord' | 'UpdateRecord' | 'DeleteRecords' | 'Paste';
  readonly tableId: string;
  readonly tableName: string;
  readonly recordIds: ReadonlyArray<string>;
  readonly changedFieldIds?: ReadonlyArray<string>;
  readonly changedFieldNames?: ReadonlyArray<string>;
  readonly changedFieldTypes?: ReadonlyArray<string>;
  readonly changeType: 'insert' | 'update' | 'delete';
};

/**
 * Information about a dependency graph edge.
 */
export type DependencyEdgeInfo = {
  readonly fromFieldId: string;
  readonly fromFieldName: string;
  readonly fromTableId: string;
  readonly fromTableName: string;
  readonly toFieldId: string;
  readonly toFieldName: string;
  readonly toTableId: string;
  readonly toTableName: string;
  readonly kind: 'same_record' | 'cross_record';
  readonly linkFieldId?: string;
};

/**
 * Information about the dependency graph.
 */
export type DependencyGraphInfo = {
  readonly fieldCount: number;
  readonly edgeCount: number;
  readonly edges: ReadonlyArray<DependencyEdgeInfo>;
};

/**
 * Information about an update step.
 */
export type UpdateStepInfo = {
  readonly level: number;
  readonly tableId: string;
  readonly tableName: string;
  readonly fieldIds: ReadonlyArray<string>;
  readonly fieldNames: ReadonlyArray<string>;
  readonly fieldTypes: ReadonlyArray<string>;
  readonly estimatedRecordCount: number;
  readonly status?: 'ok' | 'blocked';
  readonly warning?: string;
};

/**
 * Information about same-table batch optimization.
 */
export type SameTableBatchInfo = {
  readonly tableId: string;
  readonly tableName: string;
  readonly stepCount: number;
  readonly minLevel: number;
  readonly maxLevel: number;
  readonly totalFieldCount: number;
  readonly canOptimize: boolean;
};

/**
 * Estimate of affected records per table.
 */
export type AffectedRecordEstimate = {
  readonly tableId: string;
  readonly tableName: string;
  readonly estimatedCount: number;
  readonly source: 'seed' | 'propagation';
};

/**
 * Computed field impact analysis.
 */
export type ComputedImpactInfo = {
  readonly baseId: string;
  readonly seedTableId: string;
  readonly seedRecordCount: number;
  readonly dependencyGraph: DependencyGraphInfo;
  readonly updateSteps: ReadonlyArray<UpdateStepInfo>;
  readonly sameTableBatches: ReadonlyArray<SameTableBatchInfo>;
  readonly affectedRecordEstimates: ReadonlyArray<AffectedRecordEstimate>;
  readonly warnings?: ReadonlyArray<string>;
};

export type ComputedUpdateLockRecordInfo = {
  readonly tableId: string;
  readonly tableName: string;
  readonly recordId: string;
  readonly key: string;
};

export type ComputedUpdateLockTableInfo = {
  readonly tableId: string;
  readonly tableName: string;
  readonly key: string;
};

export type ComputedUpdateLockStatementInfo = {
  readonly scope: 'record' | 'batch' | 'table';
  readonly tableId: string;
  readonly tableName: string;
  readonly recordId?: string;
  readonly batchId?: string;
  readonly key: string;
  readonly sql: string;
  readonly parameters: ReadonlyArray<unknown>;
};

export type ComputedUpdateLockBatchInfo = {
  readonly tableId: string;
  readonly tableName: string;
  readonly batchId: string;
  readonly recordCount: number;
  readonly key: string;
};

export type ComputedUpdateLockInfo = {
  readonly mode: 'disabled' | 'none' | 'record' | 'batch' | 'table' | 'mixed';
  readonly reason: string;
  readonly maxRecordLocks: number;
  readonly batchShardCount: number;
  readonly seedRecordCount: number;
  readonly recordLockCount: number;
  readonly batchLockCount: number;
  readonly tableLockCount: number;
  readonly tableLockTableIds: ReadonlyArray<string>;
  readonly recordLocks: ReadonlyArray<ComputedUpdateLockRecordInfo>;
  readonly batchLocks: ReadonlyArray<ComputedUpdateLockBatchInfo>;
  readonly tableLocks: ReadonlyArray<ComputedUpdateLockTableInfo>;
  readonly statements: ReadonlyArray<ComputedUpdateLockStatementInfo>;
};

/**
 * Information about a link record lock to prevent deadlocks.
 */
export type LinkRecordLockInfo = {
  readonly foreignTableId: string;
  readonly foreignTableName?: string;
  readonly foreignRecordId: string;
  readonly key: string;
};

/**
 * Information about link record locks.
 */
export type LinkRecordLocksInfo = {
  readonly mode: 'none' | 'active';
  readonly reason: string;
  readonly lockCount: number;
  readonly locks: ReadonlyArray<LinkRecordLockInfo>;
  readonly sql?: string;
  readonly parameters?: ReadonlyArray<unknown>;
};

/**
 * PostgreSQL EXPLAIN JSON plan node.
 */
export type ExplainPlanNode = {
  readonly 'Node Type': string;
  readonly 'Parallel Aware'?: boolean;
  readonly 'Async Capable'?: boolean;
  readonly 'Relation Name'?: string;
  readonly Alias?: string;
  readonly 'Startup Cost'?: number;
  readonly 'Total Cost'?: number;
  readonly 'Plan Rows'?: number;
  readonly 'Plan Width'?: number;
  readonly 'Actual Startup Time'?: number;
  readonly 'Actual Total Time'?: number;
  readonly 'Actual Rows'?: number;
  readonly 'Actual Loops'?: number;
  readonly Output?: ReadonlyArray<string>;
  readonly Filter?: string;
  readonly 'Rows Removed by Filter'?: number;
  readonly 'Join Type'?: string;
  readonly 'Inner Unique'?: boolean;
  readonly 'Hash Cond'?: string;
  readonly 'Index Name'?: string;
  readonly 'Index Cond'?: string;
  readonly 'Scan Direction'?: string;
  readonly 'Shared Hit Blocks'?: number;
  readonly 'Shared Read Blocks'?: number;
  readonly 'Shared Dirtied Blocks'?: number;
  readonly 'Shared Written Blocks'?: number;
  readonly 'Local Hit Blocks'?: number;
  readonly 'Local Read Blocks'?: number;
  readonly 'Local Dirtied Blocks'?: number;
  readonly 'Local Written Blocks'?: number;
  readonly 'Temp Read Blocks'?: number;
  readonly 'Temp Written Blocks'?: number;
  readonly Plans?: ReadonlyArray<ExplainPlanNode>;
  readonly [key: string]: unknown;
};

/**
 * PostgreSQL EXPLAIN JSON output structure.
 */
export type ExplainJsonOutput = {
  readonly Plan: ExplainPlanNode;
  readonly 'Planning Time'?: number;
  readonly 'Execution Time'?: number;
  readonly Triggers?: ReadonlyArray<unknown>;
};

/**
 * EXPLAIN output (without ANALYZE).
 */
export type ExplainOutput = {
  readonly plan: ExplainJsonOutput;
  readonly estimatedCost?: number;
  readonly estimatedRows?: number;
  /**
   * When a batch EXPLAIN ANALYZE fails for this statement, we may fall back to EXPLAIN ONLY
   * and attach the original ANALYZE error here.
   */
  readonly analyzeError?: string;
};

/**
 * EXPLAIN ANALYZE output.
 */
export type ExplainAnalyzeOutput = {
  readonly plan: ExplainJsonOutput;
  readonly planningTimeMs?: number;
  readonly executionTimeMs?: number;
  readonly actualRows?: number;
  readonly estimatedRows?: number;
};

/**
 * Seed field that triggered computed updates.
 */
export type ComputedUpdateSeedField = {
  readonly fieldId: string;
  readonly fieldName: string;
  readonly fieldType: string;
  readonly tableId: string;
  readonly tableName: string;
  readonly impact: 'value' | 'link_relation';
};

/**
 * Direct dependency of a computed field.
 */
export type ComputedUpdateDependency = {
  readonly fromFieldId: string;
  readonly fromFieldName: string;
  readonly fromFieldType: string;
  readonly fromTableId: string;
  readonly fromTableName: string;
  readonly kind: 'same_record' | 'cross_record';
  readonly semantic?: string;
  readonly linkFieldId?: string;
  readonly isSeed: boolean;
};

/**
 * Computed field updated in a batch, including dependencies.
 */
export type ComputedUpdateTargetField = {
  readonly fieldId: string;
  readonly fieldName: string;
  readonly fieldType: string;
  readonly tableId: string;
  readonly tableName: string;
  readonly dependencies: ReadonlyArray<ComputedUpdateDependency>;
};

/**
 * Reason details for computed update batches.
 */
export type ComputedUpdateReason = {
  readonly changeType: 'insert' | 'update' | 'delete';
  readonly seedFields: ReadonlyArray<ComputedUpdateSeedField>;
  readonly targetFields: ReadonlyArray<ComputedUpdateTargetField>;
  readonly notes: ReadonlyArray<string>;
};

/**
 * SQL explain information for a single step.
 */
export type SqlExplainInfo = {
  readonly stepDescription: string;
  readonly sql: string;
  readonly parameters: ReadonlyArray<unknown>;
  readonly explainAnalyze: ExplainAnalyzeOutput | null;
  readonly explainOnly: ExplainOutput | null;
  readonly explainError?: string | null;
  readonly computedReason?: ComputedUpdateReason;
};

/**
 * Timing information for the explain operation.
 */
export type ExplainTiming = {
  readonly totalMs: number;
  readonly dependencyGraphMs: number;
  readonly planningMs: number;
  readonly sqlExplainMs: number;
};

/**
 * Complete explain result.
 */
export type ExplainResult = {
  readonly command: CommandExplainInfo;
  readonly computedImpact: ComputedImpactInfo | null;
  readonly computedLocks?: ComputedUpdateLockInfo | null;
  readonly linkLocks?: LinkRecordLocksInfo | null;
  readonly sqlExplains: ReadonlyArray<SqlExplainInfo>;
  readonly complexity: import('./ComplexityAssessment').ComplexityAssessment;
  readonly timing: ExplainTiming;
};
