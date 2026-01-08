/**
 * Types for command explain results.
 */

/**
 * Information about the command being explained.
 */
export type CommandExplainInfo = {
  readonly type: 'CreateRecord' | 'UpdateRecord' | 'DeleteRecords';
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
};

/**
 * EXPLAIN output (without ANALYZE).
 */
export type ExplainOutput = {
  readonly raw: string;
  readonly estimatedCost?: number;
  readonly estimatedRows?: number;
};

/**
 * EXPLAIN ANALYZE output.
 */
export type ExplainAnalyzeOutput = {
  readonly raw: string;
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
  readonly sqlExplains: ReadonlyArray<SqlExplainInfo>;
  readonly complexity: import('./ComplexityAssessment').ComplexityAssessment;
  readonly timing: ExplainTiming;
};
