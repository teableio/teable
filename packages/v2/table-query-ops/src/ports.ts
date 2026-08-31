import type {
  DomainError,
  IExecutionContext,
  IRecordSearchAccessPath,
  Table,
  TableId,
} from '@teable/v2-core';
import { ok, type Result } from 'neverthrow';

import type { TableQueryDecisionLogEntry } from './decisionPolicy';
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

export interface TableQueryObservationPublisher {
  publish(context: IExecutionContext, observation: TableQueryObservationWindow): void;
}

export interface TableQueryObservationBatchSink {
  recordBatch(
    context: IExecutionContext,
    input: {
      readonly writerId: string;
      readonly observations: ReadonlyArray<TableQueryObservationWindow>;
    }
  ): Promise<Result<void, DomainError>>;
}

export class NoopTableQueryObservationPublisher implements TableQueryObservationPublisher {
  publish(context: IExecutionContext, observation: TableQueryObservationWindow): void {
    void context;
    void observation;
  }
}

export interface TableQueryObservationSink {
  record(
    context: IExecutionContext,
    observation: TableQueryObservationWindow
  ): Promise<Result<void, DomainError>>;
}

export type TableQuerySearchHeatByTable = {
  readonly spaceId?: string;
  readonly baseId: string;
  readonly tableId: string;
  readonly requestCount: number;
  readonly slowCount: number;
  readonly timeoutCount: number;
  readonly dbErrorCount: number;
  readonly totalDurationMs: number;
  readonly maxDurationMs: number;
  readonly windowStart: Date;
  readonly windowSizeSeconds: number;
  readonly fieldCount: number;
  readonly allFields: boolean;
};

export interface TableQueryObservationReader {
  findRecent(
    context: IExecutionContext,
    input: {
      readonly since: Date;
      readonly limit: number;
      readonly tableId?: string;
    }
  ): Promise<Result<ReadonlyArray<TableQueryObservationWindow>, DomainError>>;
  findSearchHeatByTable(
    context: IExecutionContext,
    input: {
      readonly since: Date;
      readonly minSlowCount: number;
      readonly limit: number;
      readonly wideSearchFields: number;
    }
  ): Promise<Result<ReadonlyArray<TableQuerySearchHeatByTable>, DomainError>>;
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

export interface TableQueryDecisionLogRepository {
  save(
    context: IExecutionContext,
    entry: TableQueryDecisionLogEntry
  ): Promise<Result<TableQueryDecisionLogEntry, DomainError>>;

  findRecentByScope(
    context: IExecutionContext,
    input: {
      readonly tableId: string;
      readonly scopeKey: string;
      readonly limit: number;
    }
  ): Promise<Result<ReadonlyArray<TableQueryDecisionLogEntry>, DomainError>>;

  findLatestByRecommendation(
    context: IExecutionContext,
    input: {
      readonly recommendationId: string;
    }
  ): Promise<Result<TableQueryDecisionLogEntry | undefined, DomainError>>;
}

export class NoopTableQueryDecisionLogRepository implements TableQueryDecisionLogRepository {
  async save(
    _context: IExecutionContext,
    entry: TableQueryDecisionLogEntry
  ): Promise<Result<TableQueryDecisionLogEntry, DomainError>> {
    return ok(entry);
  }

  async findRecentByScope(): Promise<
    Result<ReadonlyArray<TableQueryDecisionLogEntry>, DomainError>
  > {
    return ok([]);
  }

  async findLatestByRecommendation(): Promise<
    Result<TableQueryDecisionLogEntry | undefined, DomainError>
  > {
    return ok(undefined);
  }
}

type TableSearchAccessPathReclaimCandidateBase = {
  readonly tableId: string;
  readonly baseId: string;
  /** Candidate key of the access-path config; used as the decision scope. */
  readonly scopeKey: string;
  /** Optimistic concurrency token for the config row observed by the sweep. */
  readonly configVersion: string;
  readonly accessPathReadyAt: Date;
  readonly lastSearchActivityAt?: Date;
  /** idx_scan delta over the idle window; undefined = unknown (never reclaimed on). */
  readonly indexScanDelta?: number;
};

export type TableSearchAccessPathReclaimCandidate =
  | (TableSearchAccessPathReclaimCandidateBase & { readonly phase: 'active' })
  | (TableSearchAccessPathReclaimCandidateBase & {
      readonly phase: 'drop_due';
      readonly dropAfter: Date;
    });

export interface TableSearchAccessPathReclaimSource {
  listCandidates(
    context: IExecutionContext,
    input: {
      readonly now: Date;
      readonly minHoldMs: number;
      readonly idleMs: number;
    }
  ): Promise<Result<ReadonlyArray<TableSearchAccessPathReclaimCandidate>, DomainError>>;

  beginGrace(
    context: IExecutionContext,
    input: {
      readonly tableId: string;
      readonly scopeKey: string;
      readonly expectedVersion: string;
      readonly disabledAt: Date;
      readonly dropAfter: Date;
    }
  ): Promise<Result<boolean, DomainError>>;

  claimDueDrop(
    context: IExecutionContext,
    input: {
      readonly tableId: string;
      readonly scopeKey: string;
      readonly now: Date;
    }
  ): Promise<Result<boolean, DomainError>>;

  releaseDueDrop(
    context: IExecutionContext,
    input: {
      readonly tableId: string;
      readonly scopeKey: string;
    }
  ): Promise<Result<void, DomainError>>;
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

  saveIfAbsent(
    context: IExecutionContext,
    task: TableQueryRemediationTask
  ): Promise<Result<boolean, DomainError>>;

  claimNextAccepted(
    context: IExecutionContext,
    input: {
      readonly workerId: string;
      readonly now: Date;
      readonly allowedKinds: ReadonlyArray<ExecutablePhase1RemediationKind>;
      readonly allowManualIndexExecution: boolean;
      readonly allowPolicyIndexExecution: boolean;
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

export type ReconcileTableSearchAccessPathInput = {
  readonly table: Table;
  // 'drop' removes the managed generated column + index and disables the
  // table's config — the table-level kill switch for the indexed search path.
  readonly mode: 'create' | 'rebuild' | 'drop';
  readonly expectedDefinitionKey?: string;
  readonly semantics?: 'substring' | 'lexical';
  readonly provider?: 'pg_trgm' | 'pg_bigm' | 'tsvector';
  readonly languageConfig?: string;
  readonly fieldIds?: readonly string[];
  readonly searchProbe?: string;
  readonly validationMode?: 'plan' | 'real_ddl';
  readonly allowLargeTableRewrite?: boolean;
};

export type ReconcileTableSearchAccessPathResult = {
  readonly action: 'created' | 'rebuilt' | 'verified' | 'dropped';
  readonly tableId: string;
  readonly definitionKey: string;
  readonly generatedColumnName: string;
  readonly indexName: string;
  readonly languageConfig: string;
  readonly semantics?: 'substring' | 'lexical';
  readonly provider?: 'pg_trgm' | 'pg_bigm' | 'tsvector';
  readonly fieldIds: readonly string[];
  readonly status: 'ready' | 'disabled';
  readonly planEvidence?: unknown;
};

export interface TableSearchAccessPathReconciler {
  reconcile(
    context: IExecutionContext,
    input: ReconcileTableSearchAccessPathInput
  ): Promise<Result<ReconcileTableSearchAccessPathResult, DomainError>>;

  maintainAfterSchemaChange(
    context: IExecutionContext,
    table: Table
  ): Promise<Result<ReconcileTableSearchAccessPathResult | undefined, DomainError>>;
}

export type ReconcileTableSearchVectorInput = ReconcileTableSearchAccessPathInput;
export type ReconcileTableSearchVectorResult = ReconcileTableSearchAccessPathResult;
export type TableSearchVectorReconciler = TableSearchAccessPathReconciler;

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
  readonly semantics?: 'substring' | 'lexical';
  readonly provider?: 'pg_trgm' | 'pg_bigm' | 'tsvector';
  readonly accessPath?: 'generated_text' | 'generated_tsvector';
  readonly coveredFieldCount: number;
};

export interface TableSearchVectorStatusReader {
  read(
    context: IExecutionContext,
    tableId: string
  ): Promise<Result<TableSearchVectorStatus, DomainError>>;
}

/**
 * Resolves the ready-to-use record search access path for a table, or
 * undefined when none is configured/ready. This is the read-path port the app
 * layer uses instead of querying the config storage directly.
 */
export interface TableSearchAccessPathResolver {
  resolve(
    context: IExecutionContext,
    tableId: string
  ): Promise<Result<IRecordSearchAccessPath | undefined, DomainError>>;
}

export type TableSearchAccessPathProvider = 'pg_trgm' | 'pg_bigm';
export type TableSearchAccessPathCapabilityState =
  | 'ready'
  | 'requires_database_extension'
  | 'requires_cluster_restart'
  | 'unavailable';

export type TableSearchAccessPathCapability = {
  readonly provider: TableSearchAccessPathProvider;
  readonly extensionName: 'pg_trgm' | 'pg_bigm';
  readonly operatorClass: 'gin_trgm_ops' | 'gin_bigm_ops';
  readonly operatorClassSchema?: string;
  readonly operatorClassInstalled: boolean;
  readonly minimumProbeLength: number;
  readonly state: TableSearchAccessPathCapabilityState;
  readonly installed: boolean;
  readonly available: boolean;
  readonly preloaded: boolean;
  readonly reason?: string;
};

export interface TableSearchAccessPathCapabilityReader {
  read(
    context: IExecutionContext
  ): Promise<Result<ReadonlyArray<TableSearchAccessPathCapability>, DomainError>>;
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

export class NoopTableSearchVectorSchemaMaintenanceScheduler
  implements TableSearchVectorSchemaMaintenanceScheduler
{
  async schedule(): Promise<
    Result<TableSearchVectorSchemaMaintenanceSchedule | undefined, DomainError>
  > {
    return ok(undefined);
  }
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
  readonly allowPolicyIndexExecution: boolean;
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
