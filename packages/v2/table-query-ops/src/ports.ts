import type { DomainError, IExecutionContext, Table, TableId } from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type {
  ExecutablePhase1RemediationKind,
  TablePhysicalStats,
  TableQueryIndexInspection,
  TableQueryObservationWindow,
  TableQueryPlanValidation,
  TableQueryRecommendation,
  TableQueryRemediationTask,
  TableQueryShape,
} from './domain';

export interface TableQueryObservationSink {
  record(
    context: IExecutionContext,
    observation: TableQueryObservationWindow
  ): Promise<Result<void, DomainError>>;
}

export interface TableQueryObservationReader {
  findRecent(
    context: IExecutionContext,
    input: {
      readonly since: Date;
      readonly limit: number;
      readonly tableId?: string;
    }
  ): Promise<Result<ReadonlyArray<TableQueryObservationWindow>, DomainError>>;
}

export interface TablePhysicalStatsReader {
  read(context: IExecutionContext, table: Table): Promise<Result<TablePhysicalStats, DomainError>>;
}

export interface TableQueryIndexInspector {
  inspect(
    context: IExecutionContext,
    table: Table,
    shape: TableQueryShape
  ): Promise<Result<TableQueryIndexInspection, DomainError>>;
}

export interface TableQueryPlanValidator {
  validate(
    context: IExecutionContext,
    input: {
      readonly table: Table;
      readonly observation: TableQueryObservationWindow;
      readonly indexInspection: TableQueryIndexInspection;
    }
  ): Promise<Result<TableQueryPlanValidation, DomainError>>;
}

export interface TableQueryRecommendationRepository {
  findOpenByShape(
    context: IExecutionContext,
    input: {
      readonly tableId: string;
      readonly shapeHash: string;
      readonly policyVersion: string;
    }
  ): Promise<Result<TableQueryRecommendation | undefined, DomainError>>;

  findById(
    context: IExecutionContext,
    id: string
  ): Promise<Result<TableQueryRecommendation, DomainError>>;

  save(
    context: IExecutionContext,
    recommendation: TableQueryRecommendation
  ): Promise<Result<TableQueryRecommendation, DomainError>>;
}

export interface TableQueryRemediationTaskRepository {
  findById(
    context: IExecutionContext,
    id: string
  ): Promise<Result<TableQueryRemediationTask, DomainError>>;

  save(
    context: IExecutionContext,
    task: TableQueryRemediationTask
  ): Promise<Result<TableQueryRemediationTask, DomainError>>;

  claimNextAccepted(
    context: IExecutionContext,
    input: {
      readonly workerId: string;
      readonly now: Date;
      readonly allowedKinds: ReadonlyArray<ExecutablePhase1RemediationKind>;
    }
  ): Promise<Result<TableQueryRemediationTask | undefined, DomainError>>;
}

export interface TableQueryRemediationExecutor {
  execute(
    context: IExecutionContext,
    input: {
      readonly task: TableQueryRemediationTask;
      readonly allowManualIndexExecution: boolean;
    }
  ): Promise<Result<unknown, DomainError>>;
}

export type ReconcileTableSearchVectorInput = {
  readonly table: Table;
  readonly mode: 'create' | 'rebuild';
  readonly languageConfig?: string;
  readonly fieldIds?: readonly string[];
  readonly searchProbe?: string;
  readonly validationMode?: 'plan' | 'real_ddl';
  readonly allowLargeTableRewrite?: boolean;
};

export type ReconcileTableSearchVectorResult = {
  readonly action: 'created' | 'rebuilt' | 'verified';
  readonly tableId: string;
  readonly definitionKey: string;
  readonly generatedColumnName: string;
  readonly indexName: string;
  readonly languageConfig: string;
  readonly fieldIds: readonly string[];
  readonly status: 'ready';
  readonly planEvidence?: unknown;
};

export interface TableSearchVectorReconciler {
  reconcile(
    context: IExecutionContext,
    input: ReconcileTableSearchVectorInput
  ): Promise<Result<ReconcileTableSearchVectorResult, DomainError>>;

  maintainAfterSchemaChange(
    context: IExecutionContext,
    table: Table
  ): Promise<Result<ReconcileTableSearchVectorResult | undefined, DomainError>>;
}

export type TableSearchVectorStatusState =
  | 'disabled'
  | 'ready'
  | 'rebuild_pending'
  | 'stale'
  | 'unknown';

export type TableSearchVectorStatus = {
  readonly tableId: string;
  readonly state: TableSearchVectorStatusState;
  readonly configured: boolean;
  readonly languageConfig?: string;
  readonly coveredFieldCount: number;
};

export interface TableSearchVectorStatusReader {
  read(
    context: IExecutionContext,
    tableId: string
  ): Promise<Result<TableSearchVectorStatus, DomainError>>;
}

export type TableSearchVectorSchemaMaintenanceReason =
  | 'field_created'
  | 'field_updated'
  | 'field_deleted';

export type TableSearchVectorSchemaMaintenanceSchedule = {
  readonly tableId: string;
  readonly taskId: string;
  readonly status: 'queued' | 'coalesced';
};

export interface TableSearchVectorSchemaMaintenanceScheduler {
  schedule(
    context: IExecutionContext,
    input: {
      readonly table: Table;
      readonly reason: TableSearchVectorSchemaMaintenanceReason;
    }
  ): Promise<Result<TableSearchVectorSchemaMaintenanceSchedule | undefined, DomainError>>;
}

export interface TableQueryOpsLeaseRepository {
  acquire(
    context: IExecutionContext,
    input: {
      readonly leaseKey: string;
      readonly ownerId: string;
      readonly ttlMs: number;
      readonly now: Date;
    }
  ): Promise<Result<boolean, DomainError>>;
}

export interface TableQueryOpsClock {
  now(): Date;
}

export class SystemTableQueryOpsClock implements TableQueryOpsClock {
  now(): Date {
    return new Date();
  }
}

export interface TableQueryOpsAnalyzerConfig {
  readonly enabled: boolean;
  readonly intervalMs: number;
  readonly lookbackMs: number;
  readonly batchSize: number;
  readonly workerId: string;
}

export interface TableQueryOpsTaskWorkerConfig {
  readonly enabled: boolean;
  readonly intervalMs: number;
  readonly workerId: string;
  readonly allowManualIndexExecution: boolean;
  readonly allowedKinds: ReadonlyArray<ExecutablePhase1RemediationKind>;
}

export interface TableQueryShapeExtractor {
  fromRecordList(input: {
    readonly table: Table;
    readonly queryKind?: 'recordList' | 'search' | 'filter' | 'sort' | 'group';
    readonly searchFieldIds?: ReadonlyArray<string>;
    readonly searchValueLength?: number;
    readonly filterFieldIds?: ReadonlyArray<string>;
    readonly sortFieldIds?: ReadonlyArray<string>;
    readonly durationMs: number;
    readonly timedOut?: boolean;
    readonly errorKind?: 'timeout' | 'db_error' | 'unknown';
  }): Result<TableQueryShape, DomainError>;
}

export type AnalyzeTableQueryRiskInput = {
  readonly tableId: TableId;
  readonly observation: TableQueryObservationWindow;
};
