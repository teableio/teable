import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-shared';
import type { PostgresSqlExecutionDiagnostics } from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  domainError,
  FieldId,
  isNotFoundError,
  registerAfterCommit,
  TableByIdSpec,
  TableId,
  tableDataSafetyLimitErrors,
  v2CoreTokens,
  RecordsBatchUpdated,
  withoutTransaction,
} from '@teable/v2-core';
import type {
  BaseId,
  DomainError,
  FieldComputeLastError,
  IExecutionContext,
  IHasher,
  ITableRepository,
  IUnitOfWork,
  ILogger,
  IEventBus,
  Table,
  ITracer,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { ComputedActivityFieldError } from '../activity/IComputedActivityProjector';
import { toComputedActivityBatch } from '../activity/IComputedActivityProjector';
import {
  hasAllTargetRecordsEdge,
  resolveFieldTargetsFromPlan,
} from '../activity/resolveFieldTargets';
import {
  buildBeforeImageRecordsFromStepChanges,
  mergeBeforeImageRecords,
} from '../ComputedBeforeImageFromChanges';
import { collectContinuationFieldIdsFromExecutedSteps } from '../ComputedContinuationFields';
import type { ComputedFieldBackfillService } from '../ComputedFieldBackfillService';
import type {
  ComputedCellLimitRejection,
  ComputedFieldUpdater,
  ComputedUpdateResult,
  StepChangeData,
} from '../ComputedFieldUpdater';
import { formatComputedCellLimitErrorMessage } from '../ComputedFieldUpdater';
import type { ComputedStagePlanSplit } from '../ComputedStagePlanSplitter';
import {
  buildDeferredStagePlan,
  mergeComputedSeedGroups,
  resolveAdaptiveStageBudget,
  shouldClampToOneDependencyLevel,
  splitComputedPlanForStageBudget,
} from '../ComputedStagePlanSplitter';
import type { ComputedTaskFailureClassification } from '../ComputedTaskFailureClassifier';
import {
  classifyComputedTaskFailure,
  isTableProvisionPendingError,
} from '../ComputedTaskFailureClassifier';
import { isComputedUpdateLockUnavailable } from '../ComputedUpdateLock';
import type {
  ComputedSeedGroup,
  ComputedUpdatePlan,
  ComputedUpdatePlanner,
} from '../ComputedUpdatePlanner';
import { splitSeedGroupsForPlan } from '../ComputedUpdatePlanner';
import { createComputedUpdateRun, toRunSpanAttributes } from '../ComputedUpdateRun';
import type { ComputedUpdateRunContext } from '../ComputedUpdateRun';
import { toErrorLogFields } from '../errorLog';
import type {
  ComputedBeforeImageRecordDto,
  ComputedRealtimeOrchestrationDto,
  ComputedUpdateSeedGroupDto,
  ComputedUpdateOutboxItem,
  ComputedUpdateOutboxPayload,
  ComputedUpdateOutboxTaskInput,
} from '../outbox/ComputedUpdateOutboxPayload';
import {
  buildContinuationPlanHash,
  buildOutboxTaskInput,
  deserializeComputedUpdatePlan,
  serializeComputedUpdatePlan,
} from '../outbox/ComputedUpdateOutboxPayload';
import type { ComputedUpdateSeedTaskInput } from '../outbox/ComputedUpdateSeedPayload';
import { deserializeSeedPayload } from '../outbox/ComputedUpdateSeedPayload';
import { buildFieldBackfillTaskInput } from '../outbox/FieldBackfillOutboxPayload';
import type {
  AnyOutboxItem,
  ComputedTaskFailureDiagnostics,
  ComputedUpdateOutboxConfig,
  FieldBackfillOutboxItem,
  SeedOutboxItem,
  IComputedUpdateOutbox,
} from '../outbox/IComputedUpdateOutbox';
import { isFieldBackfillOutboxItem, isSeedOutboxItem } from '../outbox/IComputedUpdateOutbox';
import { pushAll } from '../pushAll';

/**
 * Maximum stage depth to prevent cascading update loops.
 * Each time a computed update creates a follow-up task, the stage depth increments.
 * When this limit is reached, no more follow-up tasks are created.
 */
const MAX_STAGE_DEPTH = 50;
// Wakeup-driven cascades chase announced follow-up stages in the same
// invocation; bound the chain length one wakeup may process before handing
// back to the drain loop / later wakeups.
const RUN_TASK_BY_ID_CONTINUATION_BUDGET = 50;
/**
 * Lock-miss requeues carry no attempt budget (they must not consume retries toward the
 * dead letter), so a task starving on a hot key only surfaces through this warning.
 */
const TASK_REQUEUE_STARVATION_WARN_AGE_MS = 5 * 60 * 1000;
const maxComputedEventLogItems = 10;
const maxComputedEventLogFieldIds = 20;
const maxComputedEventLogRecordIds = 10;

const ASYNC_COMPUTED_EXECUTE_OPTIONS = {
  collectChanges: true,
  lockWait: false,
  isolateOversizedComputedCells: true,
} as const;

const toFieldErrorsFromRejectedCells = (
  rejections: ReadonlyArray<ComputedCellLimitRejection> | undefined
): ReadonlyArray<ComputedActivityFieldError> | undefined => {
  if (!rejections?.length) return undefined;
  const byField = new Map<string, FieldComputeLastError>();
  for (const rejection of rejections) {
    if (byField.has(rejection.fieldId)) continue;
    byField.set(rejection.fieldId, {
      code: tableDataSafetyLimitErrors.computedCellValueMaxBytes.code,
      message: formatComputedCellLimitErrorMessage(rejection.attempted, rejection.max),
      context: {
        attempted: rejection.attempted,
        max: rejection.max,
        recordId: rejection.recordId,
        tableId: rejection.tableId,
      },
    });
  }
  return [...byField.entries()].map(([fieldId, error]) => ({ fieldId, error }));
};

const toMarkDoneFieldErrorOptions = (
  rejections: ReadonlyArray<ComputedCellLimitRejection> | undefined
): { fieldErrors: ReadonlyArray<ComputedActivityFieldError> } | undefined => {
  const fieldErrors = toFieldErrorsFromRejectedCells(rejections);
  return fieldErrors?.length ? { fieldErrors } : undefined;
};

const toRunHistoryPlan = (plan: ComputedUpdatePlan) => {
  const payload = serializeComputedUpdatePlan(plan);
  return { steps: payload.steps, edges: payload.edges };
};

const sourceFieldIdsOf = (task: AnyOutboxItem): ReadonlyArray<string> | undefined => {
  if (isSeedOutboxItem(task)) {
    return task.changedFieldIds.length ? task.changedFieldIds : undefined;
  }
  if ('sourceFieldIds' in task && task.sourceFieldIds?.length) {
    return task.sourceFieldIds;
  }
  return undefined;
};

const buildFailureDiagnostics = (
  error: DomainError,
  failure: ComputedTaskFailureClassification,
  phase: string
): ComputedTaskFailureDiagnostics => {
  const execution = error.details?.postgresSql as PostgresSqlExecutionDiagnostics | undefined;
  const details = error.details
    ? Object.fromEntries(Object.entries(error.details).filter(([key]) => key !== 'postgresSql'))
    : undefined;
  return {
    version: 1,
    failure: {
      kind: failure.failureKind,
      reason: failure.failureReason,
      retryable: failure.retryable,
      directDeadLetter: !failure.retryable,
      phase,
      ...(details && Object.keys(details).length > 0 ? { details } : {}),
    },
    ...(execution ? { execution } : {}),
  };
};

type SeedRecordChunk = {
  seedRecordIds: string[];
  extraSeedRecords: ComputedUpdateSeedGroupDto[];
};

/**
 * A follow-up task announced by a finished task. When the enqueue transaction
 * relay-claimed the continuation, `claimed` carries the ready-to-process item
 * and the queue loop skips the separate claimById round trip.
 */
type ContinuationRef = {
  taskId: string;
  claimed?: AnyOutboxItem;
};

type LoadTaskTableResult =
  | {
      status: 'loaded';
      table: Table;
    }
  | {
      status: 'blocked';
    }
  | {
      status: 'completed';
    };

const countSeedRecordDtos = (
  seedRecordIds: ReadonlyArray<string>,
  extraSeedRecords: ReadonlyArray<ComputedUpdateSeedGroupDto>
): number =>
  seedRecordIds.length + extraSeedRecords.reduce((sum, group) => sum + group.recordIds.length, 0);

const splitSeedRecordDtos = (params: {
  seedTableId: string;
  seedRecordIds: ReadonlyArray<string>;
  extraSeedRecords: ReadonlyArray<ComputedUpdateSeedGroupDto>;
  maxSeedRecordsPerTask: number;
}): SeedRecordChunk[] => {
  const maxSeedRecordsPerTask = Math.max(1, Math.trunc(params.maxSeedRecordsPerTask));
  const totalSeedRecords = countSeedRecordDtos(params.seedRecordIds, params.extraSeedRecords);
  if (totalSeedRecords <= maxSeedRecordsPerTask) return [];

  const chunks: SeedRecordChunk[] = [];
  let current: SeedRecordChunk = { seedRecordIds: [], extraSeedRecords: [] };
  let currentCount = 0;

  const pushCurrent = () => {
    if (currentCount === 0) return;
    chunks.push(current);
    current = { seedRecordIds: [], extraSeedRecords: [] };
    currentCount = 0;
  };

  const appendRecords = (tableId: string, recordIds: ReadonlyArray<string>) => {
    for (const recordId of recordIds) {
      if (currentCount >= maxSeedRecordsPerTask) {
        pushCurrent();
      }

      if (tableId === params.seedTableId) {
        current.seedRecordIds.push(recordId);
      } else {
        let group = current.extraSeedRecords.find((entry) => entry.tableId === tableId);
        if (!group) {
          group = { tableId, recordIds: [] };
          current.extraSeedRecords.push(group);
        }
        group.recordIds.push(recordId);
      }
      currentCount += 1;
    }
  };

  appendRecords(params.seedTableId, params.seedRecordIds);
  for (const group of params.extraSeedRecords) {
    appendRecords(group.tableId, group.recordIds);
  }
  pushCurrent();

  return chunks;
};

const withChunkedPlanHash = (planHash: string, chunkIndex: number, chunkCount: number): string =>
  `${planHash}:chunk:${chunkIndex + 1}/${chunkCount}`;

const filterBeforeImageRecords = (
  beforeImageRecords: ReadonlyArray<ComputedBeforeImageRecordDto> | undefined,
  seedRecordIds: ReadonlyArray<string>
): ComputedBeforeImageRecordDto[] => {
  if (!beforeImageRecords || beforeImageRecords.length === 0 || seedRecordIds.length === 0) {
    return [];
  }
  const seedRecordIdSet = new Set(seedRecordIds);
  return beforeImageRecords.filter((record) => seedRecordIdSet.has(record.recordId));
};

/**
 * Bound how many child tasks fanout-aware seed split may create. Large seed batches
 * (hundreds of ids) already amortize work per task; exploding them into tiny chunks
 * overwhelms outbox drain loops (e2e + workers) without improving parallelism much.
 */
const MAX_FANOUT_CHUNKS = 16;

/**
 * Effective seed cap for a claimed computed task.
 *
 * - Hard cap: maxSeedRecordsPerTask (existing behavior).
 * - Fanout path: when dirtyStats predicts a large cascade, the plan has no
 *   allTargetRecords edges, and the seed set is still small enough to stay within
 *   MAX_FANOUT_CHUNKS, use fanoutSeedSplitMaxSeeds so small seed sets still split
 *   into parallel chunk planHashes. Never fanout-split allTarget plans — each
 *   child would still full-host-dirty and multiply work.
 */
export const resolveEffectiveMaxSeedRecordsPerTask = (
  task: Pick<
    ComputedUpdateOutboxItem,
    'edges' | 'dirtyStats' | 'seedRecordIds' | 'extraSeedRecords'
  >,
  config: Pick<
    ComputedUpdateOutboxConfig,
    'maxSeedRecordsPerTask' | 'fanoutDirtyRecordsThreshold' | 'fanoutSeedSplitMaxSeeds'
  >
): number => {
  const hardCap = Math.max(1, config.maxSeedRecordsPerTask);
  const fanoutThreshold = config.fanoutDirtyRecordsThreshold;
  if (fanoutThreshold <= 0) return hardCap;

  const hasAllTargetEdge = task.edges.some((edge) => edge.propagationMode === 'allTargetRecords');
  if (hasAllTargetEdge) return hardCap;

  const totalDirty = (task.dirtyStats ?? []).reduce(
    (sum, row) => sum + Math.max(0, Number(row.recordCount) || 0),
    0
  );
  if (totalDirty < fanoutThreshold) return hardCap;

  const seedCount = countSeedRecordDtos(task.seedRecordIds, task.extraSeedRecords);
  if (seedCount < 2) return hardCap;

  const fanoutCap = Math.max(1, config.fanoutSeedSplitMaxSeeds);
  // Skip fanout when seed set would create more than MAX_FANOUT_CHUNKS children.
  if (seedCount > fanoutCap * MAX_FANOUT_CHUNKS) return hardCap;

  return Math.min(hardCap, fanoutCap);
};

const SMALL_HOST_TASK_LIMIT = 16;

export const shouldWaitForSmallHostTask = (
  task: Pick<
    ComputedUpdateOutboxItem,
    'changeType' | 'seedRecordIds' | 'seedAllTableIds' | 'dirtyStats'
  >
): boolean => {
  // Outbox workers must try-lock. A blocking wait deadlocks when the holder is
  // another open transaction (computed-outbox-recovery lock contention).
  void task;
  return false;
};

export const shouldSkipOneLevelClamp = (
  plan: Pick<
    ComputedUpdatePlan,
    'changeType' | 'seedAllTableIds' | 'seedTableId' | 'steps' | 'edges'
  >,
  dirtyRecordEstimate: number
): boolean => {
  if (plan.changeType === 'delete') return false;
  if ((plan.seedAllTableIds?.length ?? 0) > 0) return false;
  if (dirtyRecordEstimate <= 0 || dirtyRecordEstimate > SMALL_HOST_TASK_LIMIT) return false;
  if (plan.steps.length === 0) return false;
  const hostTableId = plan.seedTableId.toString();
  if (plan.steps.some((step) => step.tableId.toString() !== hostTableId)) return false;
  // Same-table is not enough: conditional rollup/lookup and link traversal
  // still write other rows. Only a same-record formula chain (no cross-record
  // edges) can share one transaction across levels.
  return !plan.edges.some(
    (edge) =>
      edge.propagationMode === 'linkTraversal' ||
      edge.propagationMode === 'allTargetRecords' ||
      edge.propagationMode === 'conditionalFiltered'
  );
};

/**
 * A chunk's dirty prediction: the parent's per-table stats scaled by the
 * chunk's seed share, falling back to bare seed counts when the parent has no
 * stats. Resetting to seed counts unconditionally (the previous behavior)
 * destroyed the fanout estimate, letting split children of a high-fanout
 * import pass small-insert volume gates the parent correctly failed.
 */
const scaleChunkDirtyStats = (
  task: Pick<ComputedUpdateOutboxItem, 'seedTableId' | 'dirtyStats'>,
  chunk: SeedRecordChunk,
  totalSeedCount: number
): Array<{ tableId: string; recordCount: number }> => {
  const chunkSeedCount = countSeedRecordDtos(chunk.seedRecordIds, chunk.extraSeedRecords);
  const parentStats = (task.dirtyStats ?? []).filter(
    (row) => Math.max(0, Number(row.recordCount) || 0) > 0
  );
  if (parentStats.length === 0 || totalSeedCount <= 0) {
    return [
      ...(chunk.seedRecordIds.length > 0
        ? [{ tableId: task.seedTableId, recordCount: chunk.seedRecordIds.length }]
        : []),
      ...chunk.extraSeedRecords.map((group) => ({
        tableId: group.tableId,
        recordCount: group.recordIds.length,
      })),
    ];
  }
  return parentStats.map((row) => ({
    tableId: row.tableId,
    recordCount: Math.max(
      1,
      Math.ceil((Math.max(0, Number(row.recordCount) || 0) * chunkSeedCount) / totalSeedCount)
    ),
  }));
};

export const splitComputedTaskForSeedRecordLimit = (
  task: ComputedUpdateOutboxItem,
  maxSeedRecordsPerTask: number
): ComputedUpdateOutboxTaskInput[] => {
  if (task.seedAllTableIds && task.seedAllTableIds.length > 0) return [];

  const chunks = splitSeedRecordDtos({
    seedTableId: task.seedTableId,
    seedRecordIds: task.seedRecordIds,
    extraSeedRecords: task.extraSeedRecords,
    maxSeedRecordsPerTask,
  });
  if (chunks.length <= 1) return [];

  const totalSeedCount = countSeedRecordDtos(task.seedRecordIds, task.extraSeedRecords);
  return chunks.map((chunk, index) => ({
    baseId: task.baseId,
    seedTableId: task.seedTableId,
    seedRecordIds: chunk.seedRecordIds,
    extraSeedRecords: chunk.extraSeedRecords,
    beforeImageRecords: filterBeforeImageRecords(task.beforeImageRecords, chunk.seedRecordIds),
    steps: task.steps,
    sameTableBatches: task.sameTableBatches,
    edges: task.edges,
    estimatedComplexity: Math.max(1, Math.ceil(task.estimatedComplexity / chunks.length)),
    changeType: task.changeType,
    runId: task.runId,
    originRunIds: task.originRunIds,
    runTotalSteps: task.runTotalSteps,
    runCompletedStepsBefore: task.runCompletedStepsBefore,
    stageDepth: task.stageDepth,
    sourceChangedAt: task.sourceChangedAt ?? undefined,
    predecessorTaskId: task.id,
    orchestration: chunkOrchestration(task.orchestration, index, chunks.length),
    planHash: withChunkedPlanHash(task.planHash, index, chunks.length),
    dirtyStats: scaleChunkDirtyStats(task, chunk, totalSeedCount),
    affectedTableIds: task.affectedTableIds,
    affectedFieldIds: task.affectedFieldIds,
    syncMaxLevel: task.syncMaxLevel,
    seedAllCursors: task.seedAllCursors,
  }));
};

export const splitSeedTaskForSeedRecordLimit = (
  task: SeedOutboxItem,
  maxSeedRecordsPerTask: number
): ComputedUpdateSeedTaskInput[] => {
  const chunks = splitSeedRecordDtos({
    seedTableId: task.seedTableId,
    seedRecordIds: task.seedRecordIds,
    extraSeedRecords: task.extraSeedRecords,
    maxSeedRecordsPerTask,
  });
  if (chunks.length <= 1) return [];

  return chunks.map((chunk, index) => ({
    taskType: 'seed',
    baseId: task.baseId,
    seedTableId: task.seedTableId,
    seedRecordIds: chunk.seedRecordIds,
    extraSeedRecords: chunk.extraSeedRecords,
    beforeImageRecords: filterBeforeImageRecords(task.beforeImageRecords, chunk.seedRecordIds),
    changedFieldIds: task.changedFieldIds,
    changeType: task.changeType,
    impact: task.impact,
    cyclePolicy: task.cyclePolicy,
    orchestration: chunkOrchestration(task.orchestration, index, chunks.length),
    runId: task.runId,
    sourceChangedAt: task.sourceChangedAt ?? undefined,
    planHash: withChunkedPlanHash(task.planHash, index, chunks.length),
  }));
};

const chunkOrchestration = (
  orchestration: ComputedRealtimeOrchestrationDto | undefined,
  chunkIndex: number,
  chunkCount: number
): ComputedRealtimeOrchestrationDto | undefined => {
  if (!orchestration) return undefined;
  return {
    ...orchestration,
    totalChunkCount: Math.max(orchestration.totalChunkCount, chunkCount),
    chunkIndex,
    scope: 'chunk',
  };
};

export type ComputedUpdateWorkerParams = {
  workerId: string;
  limit: number;
  actorId?: ActorId;
  tracer?: ITracer;
  /** Request ID for ShareDB src matching (propagated from original request) */
  requestId?: string;
};

export type ComputedUpdateWorkerRunTaskByIdParams = {
  taskId: string;
  workerId: string;
  actorId?: ActorId;
  tracer?: ITracer;
  requestId?: string;
  allowProcessingTakeover?: boolean;
};

class ClaimedTaskLeaseManager {
  private readonly taskOwners = new Map<string, string>();
  private readonly lostTaskIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private heartbeatPromise: Promise<void> | null = null;

  constructor(
    tasks: ReadonlyArray<AnyOutboxItem>,
    private readonly outbox: IComputedUpdateOutbox,
    private readonly logger: ILogger,
    private readonly heartbeatIntervalMs: number
  ) {
    for (const task of tasks) {
      if (task.lockedBy) {
        this.taskOwners.set(task.id, task.lockedBy);
      }
    }
  }

  start(): void {
    if (this.taskOwners.size === 0 || this.heartbeatIntervalMs <= 0 || this.timer) return;
    this.timer = setInterval(() => {
      void this.heartbeat();
    }, this.heartbeatIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.heartbeatPromise) {
      await this.heartbeatPromise;
    }
  }

  /** Track a continuation task claimed after the manager started. */
  addTask(task: AnyOutboxItem): void {
    if (task.lockedBy) {
      this.taskOwners.set(task.id, task.lockedBy);
      this.start();
    }
  }

  releaseTask(taskId: string): void {
    this.taskOwners.delete(taskId);
    this.lostTaskIds.delete(taskId);
    if (this.taskOwners.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async ensureTaskActive(taskId: string): Promise<boolean> {
    if (this.lostTaskIds.has(taskId)) return false;
    const leaseOwner = this.taskOwners.get(taskId);
    if (!leaseOwner) return true;

    await this.heartbeat([taskId]);
    return !this.lostTaskIds.has(taskId);
  }

  private async heartbeat(taskIds?: string[]): Promise<void> {
    if (this.taskOwners.size === 0) return;
    if (this.heartbeatPromise) {
      await this.heartbeatPromise;
      if (!taskIds) return;
    }

    this.heartbeatPromise = this.runHeartbeat(taskIds).finally(() => {
      this.heartbeatPromise = null;
    });
    await this.heartbeatPromise;
  }

  private async runHeartbeat(taskIds?: string[]): Promise<void> {
    const groupedTaskIds = this.groupTaskIds(taskIds);
    if (groupedTaskIds.size === 0) return;

    for (const [leaseOwner, ids] of groupedTaskIds) {
      const renewResult = await this.outbox.renewLease({
        taskIds: ids,
        leaseOwner,
      });

      if (renewResult.isErr()) {
        this.logger.warn('computed:worker:lease_renew_failed', {
          leaseOwner,
          taskIds: ids,
          error: renewResult.error.message,
        });
        continue;
      }

      const renewedIds = new Set(renewResult.value);
      const lostIds = ids.filter((id) => !renewedIds.has(id));
      if (lostIds.length === 0) continue;

      for (const lostId of lostIds) {
        this.taskOwners.delete(lostId);
        this.lostTaskIds.add(lostId);
      }

      this.logger.warn('computed:worker:lease_lost', {
        leaseOwner,
        taskIds: lostIds,
      });
    }
  }

  private groupTaskIds(taskIds?: string[]): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    const ids = taskIds ?? [...this.taskOwners.keys()];

    for (const taskId of ids) {
      const leaseOwner = this.taskOwners.get(taskId);
      if (!leaseOwner) continue;
      const group = grouped.get(leaseOwner) ?? [];
      group.push(taskId);
      grouped.set(leaseOwner, group);
    }

    return grouped;
  }
}

const mergeSeedAllTableIdLists = (
  base: ReadonlyArray<TableId>,
  extraTableIdStrings: ReadonlyArray<string>
): TableId[] => {
  const merged = new Map<string, TableId>(base.map((tableId) => [tableId.toString(), tableId]));
  for (const tableIdString of extraTableIdStrings) {
    if (merged.has(tableIdString)) continue;
    const created = TableId.create(tableIdString);
    if (created.isOk()) merged.set(tableIdString, created.value);
  }
  return [...merged.values()];
};

/**
 * Background worker that processes computed update outbox tasks.
 *
 * Example
 * ```typescript
 * const processed = await worker.runOnce({ workerId: 'worker-1', limit: 10 });
 * ```
 */
@injectable()
export class ComputedUpdateWorker {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateOutbox)
    private readonly outbox: IComputedUpdateOutbox,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig)
    private readonly outboxConfig: ComputedUpdateOutboxConfig,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldUpdater)
    private readonly updater: ComputedFieldUpdater,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly planner: ComputedUpdatePlanner,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: IUnitOfWork,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2CoreTokens.hasher)
    private readonly hasher: IHasher,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldBackfillService)
    private readonly backfillService: ComputedFieldBackfillService,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: IEventBus
  ) {}

  async runOnce(params: ComputedUpdateWorkerParams): Promise<Result<number, DomainError>> {
    const span = params.tracer?.startSpan('teable.worker.runOnce', {
      'worker.id': params.workerId,
      'worker.limit': params.limit,
    });

    const executeRunOnce = async (): Promise<Result<number, DomainError>> => {
      return safeTry<number, DomainError>(
        async function* (this: ComputedUpdateWorker) {
          const actorIdResult = params.actorId ? ok(params.actorId) : ActorId.create('system');
          if (actorIdResult.isErr()) return err(actorIdResult.error);

          const baseContext: IExecutionContext = {
            actorId: actorIdResult.value,
            tracer: params.tracer,
            requestId: params.requestId,
          };

          const claimed = yield* await this.outbox.claimBatch(
            {
              workerId: params.workerId,
              limit: params.limit,
            },
            baseContext
          );

          if (claimed.length === 0) return ok(0);

          this.logger.debug('computed:worker:runOnce:start', {
            claimedTasks: claimed.length,
            taskTypes: claimed.map((t) =>
              isFieldBackfillOutboxItem(t) ? 'backfill' : isSeedOutboxItem(t) ? 'seed' : 'computed'
            ),
          });

          const leaseManager = this.createLeaseManager(claimed);
          leaseManager.start();

          const outcome = await this.processTaskQueue({
            initialTasks: claimed,
            leaseManager,
            workerId: params.workerId,
            actorId: actorIdResult.value,
            tracer: params.tracer,
            requestId: params.requestId,
            baseContext,
            continuationBudget: Math.max(params.limit, claimed.length),
          });

          span?.setAttribute('worker.processedCount', outcome.processed);
          return ok(outcome.processed);
        }.bind(this)
      );
    };

    try {
      if (span && params.tracer) {
        return await params.tracer.withSpan(span, executeRunOnce);
      }
      return await executeRunOnce();
    } finally {
      span?.end();
    }
  }

  async runTaskById(
    params: ComputedUpdateWorkerRunTaskByIdParams
  ): Promise<Result<boolean, DomainError>> {
    const span = params.tracer?.startSpan('teable.worker.runTaskById', {
      'worker.id': params.workerId,
      'outbox.taskId': params.taskId,
    });

    const executeRunTaskById = async (): Promise<Result<boolean, DomainError>> => {
      return safeTry<boolean, DomainError>(
        async function* (this: ComputedUpdateWorker) {
          const actorIdResult = params.actorId ? ok(params.actorId) : ActorId.create('system');
          if (actorIdResult.isErr()) return err(actorIdResult.error);

          const context: IExecutionContext = {
            actorId: actorIdResult.value,
            tracer: params.tracer,
            requestId: params.requestId,
          };

          const claimed = yield* await this.outbox.claimById(
            {
              taskId: params.taskId,
              workerId: params.workerId,
              allowProcessingTakeover: params.allowProcessingTakeover ?? false,
            },
            context
          );

          span?.setAttribute('outbox.taskClaimed', claimed != null);
          if (!claimed) return ok(false);

          const taskKind = isFieldBackfillOutboxItem(claimed)
            ? 'field-backfill'
            : isSeedOutboxItem(claimed)
              ? 'seed'
              : 'computed';
          span?.setAttributes({
            'outbox.baseId': claimed.baseId,
            'outbox.taskKind': taskKind,
            'outbox.taskAgeMs': Math.max(0, Date.now() - claimed.createdAt.getTime()),
            'outbox.attempts': claimed.attempts,
          });

          if (!isFieldBackfillOutboxItem(claimed)) {
            span?.setAttribute('outbox.seedTableId', claimed.seedTableId);
          }

          if (!isFieldBackfillOutboxItem(claimed) && !isSeedOutboxItem(claimed)) {
            span?.setAttributes({
              ...toRunSpanAttributes({
                runId: claimed.runId,
                originRunIds: claimed.originRunIds,
                phase: 'async',
                totalSteps: claimed.runTotalSteps,
                completedStepsBefore: claimed.runCompletedStepsBefore,
                taskId: claimed.id,
              }),
              'computed.stageDepth': claimed.stageDepth ?? 0,
              'computed.stepCount': claimed.steps.length,
              'computed.edgeCount': claimed.edges.length,
              'computed.seedRecordCount': countSeedRecordDtos(
                claimed.seedRecordIds,
                claimed.extraSeedRecords
              ),
              'computed.affectedTableCount': claimed.affectedTableIds.length,
              'computed.affectedFieldCount': claimed.affectedFieldIds.length,
            });
          }

          const leaseManager = this.createLeaseManager([claimed]);
          leaseManager.start();
          // Announced follow-up stages are chased inside the same invocation;
          // wakeup-driven cascades otherwise pay one BullMQ delivery per hop.
          const outcome = await this.processTaskQueue({
            initialTasks: [claimed],
            leaseManager,
            workerId: params.workerId,
            actorId: actorIdResult.value,
            tracer: params.tracer,
            requestId: params.requestId,
            baseContext: context,
            continuationBudget: RUN_TASK_BY_ID_CONTINUATION_BUDGET,
          });
          span?.setAttribute('worker.processedCount', outcome.processed);
          return ok(outcome.firstTaskProcessed);
        }.bind(this)
      );
    };

    try {
      if (span && params.tracer) {
        return await params.tracer.withSpan(span, executeRunTaskById);
      }
      return await executeRunTaskById();
    } finally {
      span?.end();
    }
  }

  /**
   * Process a queue of claimed tasks, chasing announced follow-ups in-place.
   *
   * Cascade stages are strictly sequential: task N enqueues task N+1 on
   * completion, so waiting for the next wakeup delivery (or a claim-scan
   * round) pays a full pipeline hop to rediscover a task this worker just
   * inserted. Claim announced follow-ups directly by id and process them in
   * the same invocation. The enqueue-published wakeup stays as the crash
   * safety net; the terminal pre-check turns it into a cheap noop afterwards.
   */
  private async processTaskQueue(params: {
    initialTasks: ReadonlyArray<AnyOutboxItem>;
    leaseManager: ClaimedTaskLeaseManager;
    workerId: string;
    actorId: ActorId;
    tracer?: ITracer;
    requestId?: string;
    baseContext: IExecutionContext;
    continuationBudget: number;
  }): Promise<{ processed: number; firstTaskProcessed: boolean }> {
    const { leaseManager } = params;
    let processed = 0;
    let firstTaskProcessed = false;
    let continuationBudget = params.continuationBudget;
    let isFirst = true;
    const queue: AnyOutboxItem[] = [...params.initialTasks];

    try {
      while (queue.length > 0) {
        const task = queue.shift()!;
        const taskIsFirst = isFirst;
        isFirst = false;
        if (!(await leaseManager.ensureTaskActive(task.id))) {
          this.logger.warn('computed:worker:task_skipped_lost_lease', {
            taskId: task.id,
            leaseOwner: task.lockedBy ?? null,
          });
          leaseManager.releaseTask(task.id);
          continue;
        }

        const continuations: ContinuationRef[] = [];
        try {
          const processResult = await this.processClaimedTask(
            task,
            params.actorId,
            params.tracer,
            params.requestId,
            continuations,
            params.workerId
          );
          if (processResult.isOk() && processResult.value) {
            processed += 1;
            if (taskIsFirst) firstTaskProcessed = true;
          }
        } finally {
          leaseManager.releaseTask(task.id);
        }

        for (const continuation of continuations) {
          if (continuationBudget <= 0) {
            // A relay-claimed continuation would sit in `processing` until its
            // lease expires; hand it back to the wakeup path right away.
            if (continuation.claimed) {
              await this.releaseRelayClaimedContinuation(continuation.claimed, params.baseContext);
            }
            continue;
          }
          if (continuation.claimed) {
            continuationBudget -= 1;
            leaseManager.addTask(continuation.claimed);
            queue.push(continuation.claimed);
            continue;
          }
          const continuationClaim = await this.outbox.claimById(
            {
              taskId: continuation.taskId,
              workerId: params.workerId,
              allowProcessingTakeover: false,
            },
            params.baseContext
          );
          if (continuationClaim.isErr() || !continuationClaim.value) {
            // Deferred/raced continuations fall back to their wakeups.
            continue;
          }
          continuationBudget -= 1;
          leaseManager.addTask(continuationClaim.value);
          queue.push(continuationClaim.value);
        }
      }
    } finally {
      await leaseManager.stop();
    }

    return { processed, firstTaskProcessed };
  }

  /**
   * Return a relay-claimed continuation to `pending` when this invocation's
   * continuation budget cannot process it, so wakeups reclaim it immediately
   * instead of waiting out the processing lease.
   */
  private async releaseRelayClaimedContinuation(
    task: AnyOutboxItem,
    context: IExecutionContext
  ): Promise<void> {
    const released = await this.outbox.releaseForRetry(
      {
        task,
        reason: 'relay_claim_continuation_budget_exhausted',
        retryDelayMs: 0,
      },
      context
    );
    if (released.isErr()) {
      this.logger.warn('computed:worker:relay_claim_release_failed', {
        taskId: task.id,
        error: released.error.message,
      });
    }
  }

  private createLeaseManager(tasks: ReadonlyArray<AnyOutboxItem>): ClaimedTaskLeaseManager {
    return new ClaimedTaskLeaseManager(
      tasks,
      this.outbox,
      this.logger,
      this.outboxConfig.heartbeatIntervalMs
    );
  }

  private async applyTaskStatementTimeout(
    context: IExecutionContext,
    logContext: Record<string, unknown>
  ): Promise<Result<void, DomainError>> {
    const timeoutMs = this.outboxConfig.taskStatementTimeoutMs;
    if (timeoutMs <= 0) return ok(undefined);

    const trx = getPostgresTransaction(context);
    if (!trx) return ok(undefined);

    try {
      await trx.executeQuery(sql.raw(`SET LOCAL statement_timeout = ${timeoutMs}`).compile(trx));
      this.logger.debug('computed:worker:statement_timeout_set', {
        taskStatementTimeoutMs: timeoutMs,
        ...logContext,
      });
      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to set computed task statement timeout: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      );
    }
  }

  private async processClaimedTask(
    task: AnyOutboxItem,
    actorId: ActorId,
    tracer?: ITracer,
    requestId?: string,
    continuations?: ContinuationRef[],
    relayWorkerId?: string
  ): Promise<Result<boolean, DomainError>> {
    const taskKind = isFieldBackfillOutboxItem(task)
      ? 'field-backfill'
      : isSeedOutboxItem(task)
        ? 'seed'
        : 'computed';
    const startedAt = performance.now();
    const span = tracer?.startSpan('teable.worker.processClaimedTask', {
      'outbox.taskId': task.id,
      'outbox.taskKind': taskKind,
      'outbox.baseId': task.baseId,
      'outbox.attempts': task.attempts,
      'outbox.taskAgeMs': Math.max(0, Date.now() - task.createdAt.getTime()),
    });

    const run = async (): Promise<Result<boolean, DomainError>> => {
      if (isFieldBackfillOutboxItem(task)) {
        return this.processFieldBackfillTask(task, actorId, tracer, requestId, continuations);
      }

      if (isSeedOutboxItem(task)) {
        return this.processSeedTask(task, actorId, tracer, requestId, continuations, relayWorkerId);
      }

      return this.processComputedTask(
        task as ComputedUpdateOutboxItem,
        actorId,
        tracer,
        requestId,
        continuations,
        relayWorkerId
      );
    };

    try {
      const result = span && tracer ? await tracer.withSpan(span, run) : await run();
      span?.setAttribute('outbox.processMs', Math.round(performance.now() - startedAt));
      if (result.isErr()) {
        span?.recordError(result.error.message);
      } else {
        span?.setAttribute('outbox.processed', result.value);
      }
      return result;
    } finally {
      span?.end();
    }
  }

  private async processComputedTask(
    computedTask: ComputedUpdateOutboxItem,
    actorId: ActorId,
    tracer?: ITracer,
    requestId?: string,
    continuations?: ContinuationRef[],
    relayWorkerId?: string
  ): Promise<Result<boolean, DomainError>> {
    const context: IExecutionContext = { actorId, tracer, requestId };
    const runLogContext = {
      computedRunId: computedTask.runId,
      computedOriginRunIds: computedTask.originRunIds,
      computedTaskId: computedTask.id,
    };
    let failurePhase:
      | 'deserialize_plan'
      | 'set_statement_timeout'
      | 'collect_seed_field_ids'
      | 'collect_seed_table_ids'
      | 'acquire_locks'
      | 'execute_plan'
      | 'publish_events'
      | 'collect_dirty_seed_groups'
      | 'plan_next_stage'
      | 'enqueue_next_stage'
      | 'enqueue_stage_continuation'
      | 'mark_done' = 'deserialize_plan';
    const logTaskFailure = (error: unknown, failure?: ComputedTaskFailureClassification) => {
      this.logger.error('computed:outbox:task_failed', {
        taskId: computedTask.id,
        phase: failurePhase,
        stageDepth: computedTask.stageDepth ?? 0,
        stepCount: computedTask.steps.length,
        edgeCount: computedTask.edges.length,
        seedRecordCount: computedTask.seedRecordIds.length,
        extraSeedGroupCount: computedTask.extraSeedRecords.length,
        affectedFieldCount: computedTask.affectedFieldIds.length,
        ...failure,
        ...toErrorLogFields(error),
        ...runLogContext,
      });
    };

    const splitResult = await this.splitLargeComputedTask(
      computedTask,
      context,
      runLogContext,
      continuations
    );
    if (splitResult.isErr()) {
      logTaskFailure(splitResult.error);
      await this.handleTaskFailure(computedTask, splitResult.error.message, context);
      return err(splitResult.error);
    }
    if (splitResult.value) return ok(true);

    const payload = toPayload(computedTask);
    const planResult = deserializeComputedUpdatePlan(payload);
    if (planResult.isErr()) {
      logTaskFailure(planResult.error);
      await this.handleTaskFailure(computedTask, planResult.error.message, context);
      return err(planResult.error);
    }

    const stageSplit = this.splitPlanForStageBudget(planResult.value, computedTask.dirtyStats);
    const stagePlan = stageSplit.stagePlan;

    const totalSteps =
      computedTask.runTotalSteps > 0
        ? computedTask.runTotalSteps
        : computedTask.runCompletedStepsBefore + computedTask.steps.length;
    const runId = computedTask.runId?.length ? computedTask.runId : undefined;
    const originRunIds = computedTask.originRunIds?.length ? computedTask.originRunIds : undefined;

    failurePhase = 'collect_seed_field_ids';
    const stageFieldIdsResult = collectSeedFieldIds(computedTask);
    if (stageFieldIdsResult.isErr()) {
      logTaskFailure(stageFieldIdsResult.error);
      await this.handleTaskFailure(computedTask, stageFieldIdsResult.error.message, context);
      return err(stageFieldIdsResult.error);
    }

    failurePhase = 'collect_seed_table_ids';
    const stageTableIdsResult = collectSeedTableIds(computedTask);
    if (stageTableIdsResult.isErr()) {
      logTaskFailure(stageTableIdsResult.error);
      await this.handleTaskFailure(computedTask, stageTableIdsResult.error.message, context);
      return err(stageTableIdsResult.error);
    }

    // Continuations announced inside the transaction only become processable
    // once it commits; a rollback would leave relay-claimed refs pointing at
    // rows that never existed.
    const stagedContinuations: ContinuationRef[] = [];
    const executeResult = await this.unitOfWork.withTransaction(context, async (txContext) => {
      failurePhase = 'set_statement_timeout';
      const timeoutResult = await this.applyTaskStatementTimeout(txContext, runLogContext);
      if (timeoutResult.isErr()) return err(timeoutResult.error);

      const run = createComputedUpdateRun({
        runId,
        originRunIds,
        totalSteps,
        completedStepsBefore: computedTask.runCompletedStepsBefore,
        phase: 'async',
        taskId: computedTask.id,
      });

      failurePhase = 'acquire_locks';
      const lockResult = await this.updater.acquireLocks(stagePlan, txContext, {
        logContext: runLogContext,
        wait: false,
      });
      if (lockResult.isErr()) return err(lockResult.error);

      failurePhase = 'execute_plan';
      const ledgerScopeId = computedTask.ledgerScopeId ?? computedTask.id;
      const stageExecution = await this.runStageWithinDirtyBudget({
        plan: planResult.value,
        initialSplit: stageSplit,
        context: txContext,
        run,
        ledgerScopeId,
        logContext: runLogContext,
      });
      if (stageExecution.isErr()) return err(stageExecution.error);
      const { split: finalSplit, result: stageChanges, selfReferential } = stageExecution.value;

      const events = buildComputedUpdateEvents(
        stageChanges.changesByStep,
        planResult.value.baseId,
        computedTask.orchestration
      );
      if (events.length > 0) {
        failurePhase = 'publish_events';
        await this.publishComputedUpdateEvents(txContext, events, {
          failed: 'computed:worker:events_publish_failed',
          published: 'computed:worker:events_published',
          deferred: 'computed:worker:events_publish_deferred',
          logContext: runLogContext,
        });
      }

      const stageContinuationFieldIdsResult = collectStageContinuationFieldIds(
        planResult.value,
        finalSplit.stagePlan.steps,
        stageChanges.changesByStep,
        computedTask.ledgerScopeId ? computedTask.affectedFieldIds : [],
        stageChanges.rejectedCells
      );
      if (stageContinuationFieldIdsResult.isErr()) {
        return err(stageContinuationFieldIdsResult.error);
      }
      const stageContinuationFieldIds = stageContinuationFieldIdsResult.value;

      const settleResult = await this.settleStage({
        task: computedTask,
        plan: planResult.value,
        finalSplit,
        stageChanges,
        continuationFieldIds: stageContinuationFieldIds,
        selfReferential,
        fallbackCollectTableIds: stageTableIdsResult.value,
        runId: run.runId,
        ledgerScopeId,
        originRunIds: [...run.originRunIds],
        runTotalSteps: totalSteps,
        runCompletedStepsBefore: computedTask.runCompletedStepsBefore,
        stageDepth: computedTask.stageDepth ?? 0,
        sourceChangedAt: computedTask.sourceChangedAt,
        orchestration: computedTask.orchestration,
        context: txContext,
        logContext: runLogContext,
        continuations: stagedContinuations,
        relayWorkerId,
        setPhase: (phase) => {
          failurePhase = phase;
        },
      });
      if (settleResult.isErr()) return err(settleResult.error);
      if (settleResult.value.kind === 'done') return ok(settleResult.value.processed);
      const { seedGroups, seedAllTableIds, completedStepsAfter } = settleResult.value;

      failurePhase = 'plan_next_stage';
      const nextPlanResult = await this.planNextStage(
        planResult.value,
        txContext,
        stageContinuationFieldIds,
        seedGroups,
        seedAllTableIds,
        stageChanges.changesByStep
      );
      if (nextPlanResult.isErr()) return err(nextPlanResult.error);

      const currentStageDepth = computedTask.stageDepth ?? 0;

      let doneValue: boolean;
      if (nextPlanResult.value.steps.length > 0 || nextPlanResult.value.edges.length > 0) {
        if (currentStageDepth >= MAX_STAGE_DEPTH) {
          this.logger.warn('computed:worker:max_stage_depth_reached', {
            taskId: computedTask.id,
            stageDepth: currentStageDepth,
            skippedSteps: nextPlanResult.value.steps.length,
            ...runLogContext,
          });

          failurePhase = 'mark_done';
          const doneResult = await this.markTaskDone(
            computedTask,
            txContext,
            stageChanges.rejectedCells,
            toRunHistoryPlan(planResult.value)
          );
          if (doneResult.isErr()) return err(doneResult.error);
          doneValue = doneResult.value;
        } else {
          const nextTotalSteps =
            Math.max(totalSteps, completedStepsAfter) + nextPlanResult.value.steps.length;
          const nextTask = buildOutboxTaskInput({
            plan: nextPlanResult.value,
            dirtyStats: seedGroups.map((group) => ({
              tableId: group.tableId.toString(),
              recordCount: group.recordIds.length,
            })),
            syncMaxLevel: 0,
            hasher: this.hasher,
            runId: run.runId,
            originRunIds: [...run.originRunIds],
            runTotalSteps: nextTotalSteps,
            runCompletedStepsBefore: completedStepsAfter,
            stageDepth: currentStageDepth + 1,
            sourceChangedAt: computedTask.sourceChangedAt,
            predecessorTaskId: computedTask.id,
            sourceFieldIds: computedTask.sourceFieldIds,
            orchestration: computedTask.orchestration,
          });

          failurePhase = 'enqueue_next_stage';
          const settled = await this.enqueueContinuationAndMarkDone({
            task: computedTask,
            nextTask,
            context: txContext,
            relayWorkerId,
            fieldErrors: toFieldErrorsFromRejectedCells(stageChanges.rejectedCells),
            runHistoryPlan: toRunHistoryPlan(planResult.value),
          });
          if (settled.isErr()) return err(settled.error);
          stagedContinuations.push({
            taskId: settled.value.taskId,
            ...(settled.value.claimed ? { claimed: settled.value.claimed } : {}),
          });
          failurePhase = 'mark_done';
          doneValue = settled.value.done;
        }
      } else {
        failurePhase = 'mark_done';
        const doneResult = await this.markTaskDone(
          computedTask,
          txContext,
          stageChanges.rejectedCells,
          toRunHistoryPlan(planResult.value)
        );
        if (doneResult.isErr()) return err(doneResult.error);
        doneValue = doneResult.value;
      }

      if (!doneValue) return ok(false);
      return ok(true);
    });
    if (executeResult.isOk() && continuations) {
      pushAll(continuations, stagedContinuations);
    }
    if (executeResult.isErr()) {
      if (isComputedUpdateLockUnavailable(executeResult.error)) {
        await this.releaseTaskForRetry(
          computedTask,
          executeResult.error.message,
          context,
          this.outboxConfig.lockUnavailableRetryDelayMs
        );
        return ok(false);
      }
      const recovered = await this.recoverFromTableLookupFailure({
        task: computedTask,
        error: executeResult.error,
        context,
        logContext: runLogContext,
        referencedTableIds: [
          planResult.value.seedTableId,
          ...planResult.value.steps.map((step) => step.tableId),
          ...planResult.value.edges.flatMap((edge) => [edge.fromTableId, edge.toTableId]),
          ...(planResult.value.seedAllTableIds ?? []),
        ],
      });
      if (recovered.isErr()) {
        logTaskFailure(recovered.error);
        await this.handleTaskFailure(computedTask, recovered.error.message, context);
        return err(recovered.error);
      }
      if (recovered.value === 'retried') return ok(false);
      if (recovered.value === 'completed') return ok(true);
      if (recovered.value === 'blocked') return ok(false);

      const failure = classifyComputedTaskFailure(executeResult.error);
      logTaskFailure(executeResult.error, failure);
      await this.handleTaskFailure(computedTask, executeResult.error.message, context, {
        forceDeadLetter: !failure.retryable,
        failure,
        diagnostics: buildFailureDiagnostics(executeResult.error, failure, failurePhase),
      });
      return err(executeResult.error);
    }

    return ok(executeResult.value);
  }

  private markTaskDone(
    task: AnyOutboxItem,
    context: IExecutionContext,
    rejections?: ReadonlyArray<ComputedCellLimitRejection>,
    runHistoryPlan?: { steps: unknown; edges: unknown }
  ) {
    const fieldErrors = toMarkDoneFieldErrorOptions(rejections);
    return this.outbox.markDone(task, context, {
      ...(fieldErrors ?? {}),
      ...(runHistoryPlan ? { runHistoryPlan } : {}),
    });
  }

  /**
   * Enqueue a stage continuation and mark the predecessor task done as one
   * combined activity projection instead of two independent ones. Both outbox
   * calls still run their full lifecycle logic (merge-lock, bypass hash,
   * lease-owner check, deadlock retry, wakeup scheduling) unchanged; only the
   * per-call activity-projector round (lock + load + persist) is deferred and
   * folded into a single projectStageSettlement call covering: the
   * continuation's enqueued refs, its relay-claim (if the worker claimed its
   * own continuation), and the predecessor's completion. This removes ~2 of
   * the 3 lock/load/persist rounds a stage transaction would otherwise pay for
   * activity bookkeeping alone.
   */
  private async enqueueContinuationAndMarkDone(params: {
    task: AnyOutboxItem;
    nextTask: ComputedUpdateOutboxTaskInput;
    context: IExecutionContext;
    relayWorkerId?: string;
    fieldErrors?: ReadonlyArray<ComputedActivityFieldError>;
    runHistoryPlan?: { steps: unknown; edges: unknown };
  }): Promise<
    Result<{ taskId: string; merged: boolean; claimed?: AnyOutboxItem; done: boolean }, DomainError>
  > {
    const { task, nextTask, context, relayWorkerId, fieldErrors } = params;

    const enqueueResult = await this.outbox.enqueueOrMerge(nextTask, context, {
      ...(relayWorkerId
        ? { relayClaim: { workerId: relayWorkerId, predecessorTaskId: task.id } }
        : {}),
      skipActivityProjection: true,
    });
    if (enqueueResult.isErr()) return err(enqueueResult.error);

    const doneResult = await this.outbox.markDone(task, context, {
      skipActivityProjection: true,
      ...(params.runHistoryPlan ? { runHistoryPlan: params.runHistoryPlan } : {}),
    });
    if (doneResult.isErr()) return err(doneResult.error);

    const startedAt = task.lockedAt ?? task.createdAt;
    const durationMs =
      startedAt instanceof Date ? Math.max(0, Date.now() - startedAt.getTime()) : undefined;

    const settlementResult = await this.outbox.projectStageSettlement(
      {
        done: {
          taskId: task.id,
          baseId: task.baseId,
          durationMs,
          ...(fieldErrors?.length ? { fieldErrors } : {}),
        },
        ...(enqueueResult.value.pendingActivityEnqueue
          ? { enqueued: enqueueResult.value.pendingActivityEnqueue }
          : {}),
        ...(enqueueResult.value.claimed
          ? {
              claimed: [
                {
                  taskId: enqueueResult.value.claimed.id,
                  baseId: enqueueResult.value.claimed.baseId,
                },
              ],
            }
          : {}),
      },
      context
    );
    if (settlementResult.isErr()) return err(settlementResult.error);

    return ok({
      taskId: enqueueResult.value.taskId,
      merged: enqueueResult.value.merged,
      ...(enqueueResult.value.claimed ? { claimed: enqueueResult.value.claimed } : {}),
      done: doneResult.value,
    });
  }

  private async publishComputedUpdateEvents(
    context: IExecutionContext,
    events: ReadonlyArray<RecordsBatchUpdated>,
    logs: {
      failed: string;
      published: string;
      deferred: string;
      logContext: Record<string, unknown>;
    }
  ): Promise<void> {
    const publish = async () => {
      const publishResult = await this.eventBus.publishMany(withoutTransaction(context), events);
      if (publishResult.isErr()) {
        this.logger.warn(logs.failed, {
          error: publishResult.error.message,
          eventCount: events.length,
          ...logs.logContext,
        });
        return;
      }

      this.logger.info(logs.published, {
        ...buildComputedUpdateEventLogContext(events),
        ...logs.logContext,
      });
    };

    if (registerAfterCommit(context, publish)) {
      this.logger.debug(logs.deferred, {
        eventCount: events.length,
        ...logs.logContext,
      });
      return;
    }

    await publish();
  }

  private async handleTaskFailure(
    task: AnyOutboxItem,
    message: string,
    context?: IExecutionContext,
    options: {
      forceDeadLetter?: boolean;
      failure?: ComputedTaskFailureClassification;
      diagnostics?: ComputedTaskFailureDiagnostics;
    } = {}
  ): Promise<boolean> {
    const forceDeadLetter = options.forceDeadLetter ?? options.failure?.retryable === false;
    const result = await this.outbox.markFailed(task, message, context, {
      ...options.failure,
      directDeadLetter: forceDeadLetter || undefined,
      diagnostics: options.diagnostics,
    });
    if (result.isErr()) {
      this.logger.warn('computed:outbox:markFailed_failed', {
        taskId: task.id,
        error: result.error.message,
      });
      return false;
    }

    if (!result.value) {
      this.logger.warn('computed:outbox:markFailed_skipped', {
        taskId: task.id,
        leaseOwner: task.lockedBy ?? null,
      });
    }

    return result.value;
  }

  private async releaseTaskForRetry(
    task: AnyOutboxItem,
    reason: string,
    context?: IExecutionContext,
    retryDelayMs?: number
  ): Promise<boolean> {
    const createdAt = task.createdAt instanceof Date ? task.createdAt : undefined;
    const taskAgeMs = createdAt ? Date.now() - createdAt.getTime() : undefined;
    if (taskAgeMs !== undefined && taskAgeMs > TASK_REQUEUE_STARVATION_WARN_AGE_MS) {
      this.logger.warn('computed:worker:task_requeue_starvation', {
        taskId: task.id,
        taskAgeMs,
        reason,
      });
    }
    const result = await this.outbox.releaseForRetry(
      {
        task,
        reason,
        retryDelayMs,
      },
      context
    );
    if (result.isErr()) {
      this.logger.warn('computed:outbox:release_retry_failed', {
        taskId: task.id,
        error: result.error.message,
      });
      return false;
    }

    if (!result.value) {
      this.logger.warn('computed:outbox:release_retry_skipped', {
        taskId: task.id,
        leaseOwner: task.lockedBy ?? null,
      });
      return false;
    }

    this.logger.debug('computed:worker:lock_unavailable_requeued', {
      taskId: task.id,
      reason,
    });
    return true;
  }

  private async loadActiveTableForTask(params: {
    task: AnyOutboxItem;
    tableId: TableId;
    context: IExecutionContext;
    logContext: Record<string, unknown>;
  }): Promise<Result<LoadTaskTableResult, DomainError>> {
    const tableSpec = TableByIdSpec.create(params.tableId);
    const activeResult = await this.tableRepository.findOne(params.context, tableSpec);
    if (activeResult.isOk()) return ok({ status: 'loaded', table: activeResult.value });
    if (isTableProvisionPendingError(activeResult.error)) return err(activeResult.error);
    if (!isNotFoundError(activeResult.error)) return err(activeResult.error);

    const anyStateResult = await this.tableRepository.findOne(params.context, tableSpec, {
      state: 'all',
    });
    if (anyStateResult.isErr() && !isNotFoundError(anyStateResult.error)) {
      return err(anyStateResult.error);
    }

    // Permanently missing and trash are the same for computation: do not
    // compute, do not defer, do not dead-letter. Downstream skip happens in
    // the updater when the seed table is still live; this path completes a
    // task whose loaded table (typically the seed) is gone or recycled.
    const doneResult = await this.markTaskDone(params.task, params.context);
    if (doneResult.isErr()) return err(doneResult.error);
    if (!doneResult.value) return ok({ status: 'blocked' });

    this.logger.info(
      anyStateResult.isOk()
        ? 'computed:worker:inactive_table_task_completed'
        : 'computed:worker:missing_table_task_completed',
      {
        taskId: params.task.id,
        tableId: params.tableId.toString(),
        ...params.logContext,
      }
    );
    return ok({ status: 'completed' });
  }

  private async recoverFromTableLookupFailure(params: {
    task: AnyOutboxItem;
    error: DomainError;
    context: IExecutionContext;
    logContext: Record<string, unknown>;
    referencedTableIds: ReadonlyArray<TableId>;
  }): Promise<Result<'retried' | 'completed' | 'blocked' | 'unhandled', DomainError>> {
    if (!isTableProvisionPendingError(params.error) && !isNotFoundError(params.error)) {
      return ok('unhandled');
    }

    const requeue = async (reason: string) => {
      await this.releaseTaskForRetry(
        params.task,
        reason,
        params.context,
        this.outboxConfig.lockUnavailableRetryDelayMs
      );
      return ok('retried' as const);
    };

    if (isTableProvisionPendingError(params.error)) {
      return requeue(params.error.message);
    }

    const seen = new Set<string>();
    for (const tableId of params.referencedTableIds) {
      const key = tableId.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const tableResult = await this.loadActiveTableForTask({
        task: params.task,
        tableId,
        context: params.context,
        logContext: params.logContext,
      });
      if (tableResult.isErr()) {
        if (isTableProvisionPendingError(tableResult.error)) {
          return requeue(tableResult.error.message);
        }
        return err(tableResult.error);
      }
      if (tableResult.value.status === 'completed') return ok('completed');
      if (tableResult.value.status === 'blocked') return ok('blocked');
    }

    // Every referenced table is loadable now. The transactional miss was a
    // provision race (import/schema update), not a deleted table.
    return requeue(params.error.message);
  }

  private async splitLargeComputedTask(
    task: ComputedUpdateOutboxItem,
    context: IExecutionContext,
    logContext: Record<string, unknown>,
    continuations?: ContinuationRef[]
  ): Promise<Result<boolean, DomainError>> {
    const maxSeedRecordsPerTask = resolveEffectiveMaxSeedRecordsPerTask(task, this.outboxConfig);
    const chunks = splitComputedTaskForSeedRecordLimit(task, maxSeedRecordsPerTask);
    if (chunks.length === 0) return ok(false);

    // Parallel chunk splits are deliberately not relay-claimed: leaving them
    // pending lets other workers' wakeups pick chunks up concurrently.
    for (const chunk of chunks) {
      const enqueueResult = await this.outbox.enqueueOrMerge(chunk, context);
      if (enqueueResult.isErr()) return err(enqueueResult.error);
      continuations?.push({ taskId: enqueueResult.value.taskId });
    }

    const doneResult = await this.markTaskDone(task, context);
    if (doneResult.isErr()) return err(doneResult.error);
    if (!doneResult.value) return ok(false);

    this.logger.info('computed:worker:large_task_split', {
      taskId: task.id,
      chunkCount: chunks.length,
      seedRecordCount: countSeedRecordDtos(task.seedRecordIds, task.extraSeedRecords),
      maxSeedRecordsPerTask,
      configuredMaxSeedRecordsPerTask: this.outboxConfig.maxSeedRecordsPerTask,
      fanoutDirtyRecordsThreshold: this.outboxConfig.fanoutDirtyRecordsThreshold,
      ...logContext,
    });
    return ok(true);
  }

  private async splitLargeSeedTask(
    task: SeedOutboxItem,
    context: IExecutionContext,
    logContext: Record<string, unknown>
  ): Promise<Result<boolean, DomainError>> {
    const chunks = splitSeedTaskForSeedRecordLimit(task, this.outboxConfig.maxSeedRecordsPerTask);
    if (chunks.length === 0) return ok(false);

    for (const chunk of chunks) {
      const enqueueResult = await this.outbox.enqueueSeedTask(chunk, context);
      if (enqueueResult.isErr()) return err(enqueueResult.error);
    }

    const doneResult = await this.markTaskDone(task, context);
    if (doneResult.isErr()) return err(doneResult.error);
    if (!doneResult.value) return ok(false);

    this.logger.info('computed:worker:large_seed_task_split', {
      taskId: task.id,
      chunkCount: chunks.length,
      seedRecordCount: countSeedRecordDtos(task.seedRecordIds, task.extraSeedRecords),
      maxSeedRecordsPerTask: this.outboxConfig.maxSeedRecordsPerTask,
      ...logContext,
    });
    return ok(true);
  }

  /**
   * Process a field backfill task.
   * Loads the table, resolves field IDs, and executes the backfill.
   */
  private async processFieldBackfillTask(
    task: FieldBackfillOutboxItem,
    actorId: ActorId,
    tracer?: ITracer,
    requestId?: string,
    continuations?: ContinuationRef[]
  ): Promise<Result<boolean, DomainError>> {
    const context: IExecutionContext = { actorId, tracer, requestId };
    const runLogContext = {
      computedRunId: task.runId,
      computedTaskId: task.id,
      taskType: 'field-backfill',
    };

    this.logger.debug('computed:worker:field_backfill_start', {
      taskId: task.id,
      tableId: task.tableId,
      fieldIds: task.fieldIds,
      cursor: task.cursor,
      ...runLogContext,
    });

    // Parse field IDs
    const fieldIdsResult = task.fieldIds.reduce<Result<FieldId[], DomainError>>(
      (acc, fieldId) =>
        acc.andThen((ids) =>
          FieldId.create(fieldId).map((id) => {
            ids.push(id);
            return ids;
          })
        ),
      ok([])
    );
    if (fieldIdsResult.isErr()) {
      this.logger.error('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: fieldIdsResult.error.message,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, fieldIdsResult.error.message, context);
      return err(fieldIdsResult.error);
    }

    // Parse table ID
    const tableIdResult = TableId.create(task.tableId);
    if (tableIdResult.isErr()) {
      this.logger.error('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: tableIdResult.error.message,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, tableIdResult.error.message, context);
      return err(tableIdResult.error);
    }

    // Load table with fields
    const tableResult = await this.loadActiveTableForTask({
      task,
      tableId: tableIdResult.value,
      context,
      logContext: runLogContext,
    });
    if (tableResult.isErr()) {
      this.logger.error('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: tableResult.error.message,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, tableResult.error.message, context);
      return err(tableResult.error);
    }
    if (tableResult.value.status !== 'loaded') {
      return ok(tableResult.value.status === 'completed');
    }

    const table = tableResult.value.table;

    // Get fields to backfill
    const fieldsToBackfill: ReturnType<typeof table.getFields> = [];
    for (const fieldId of fieldIdsResult.value) {
      const fieldResult = table.getField((f) => f.id().equals(fieldId));
      if (fieldResult.isOk()) {
        (fieldsToBackfill as Array<typeof fieldResult.value>).push(fieldResult.value);
      }
    }

    if (fieldsToBackfill.length === 0) {
      this.logger.warn('computed:worker:field_backfill_no_fields', {
        taskId: task.id,
        ...runLogContext,
      });
      // Mark as done since there's nothing to backfill
      const doneResult = await this.markTaskDone(task, context);
      return doneResult;
    }

    // Execute backfill within a transaction
    const executeResult: Result<boolean, DomainError> = await this.unitOfWork.withTransaction(
      context,
      async (txContext) => {
        const timeoutResult = await this.applyTaskStatementTimeout(txContext, runLogContext);
        if (timeoutResult.isErr()) return err(timeoutResult.error);

        // Execute sync backfill for all fields
        const backfillResult = await this.backfillService.executeSyncMany(txContext, {
          table,
          fields: fieldsToBackfill,
          recordBatch: {
            cursor: task.cursor,
            size: this.outboxConfig.fieldBackfillBatchSize,
          },
        });
        if (backfillResult.isErr()) return err(backfillResult.error);

        const batch = backfillResult.value.batch;
        if (batch?.hasMore && batch.lastRecordId) {
          const continuation = buildFieldBackfillTaskInput({
            baseId: table.baseId(),
            tableId: table.id(),
            fieldIds: fieldsToBackfill.map((field) => field.id()),
            hasher: this.hasher,
            runId: task.runId,
            estimatedRowCount: task.estimatedRowCount,
            cursor: batch.lastRecordId,
          });
          const enqueueResult = await this.outbox.enqueueFieldBackfill(continuation, txContext);
          if (enqueueResult.isErr()) return err(enqueueResult.error);
          continuations?.push({ taskId: enqueueResult.value.taskId });
        }

        // Mark task as done
        const doneResult = await this.markTaskDone(task, txContext);
        if (doneResult.isErr()) return doneResult;
        if (!doneResult.value) return ok(false);

        return ok(true);
      }
    );

    if (executeResult.isErr()) {
      const failure = classifyComputedTaskFailure(executeResult.error);
      this.logger.error('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: executeResult.error.message,
        ...failure,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, executeResult.error.message, context, {
        forceDeadLetter: !failure.retryable,
        failure,
        diagnostics: buildFailureDiagnostics(executeResult.error, failure, 'execute_backfill'),
      });
      return err(executeResult.error);
    }

    this.logger.debug('computed:worker:field_backfill_done', {
      taskId: task.id,
      tableId: task.tableId,
      fieldCount: fieldsToBackfill.length,
      cursor: task.cursor,
      ...runLogContext,
    });

    return ok(true);
  }

  /**
   * Process a seed task.
   * Seed tasks contain minimal trigger information - we compute the full plan here
   * and then execute it.
   */
  private async processSeedTask(
    task: SeedOutboxItem,
    actorId: ActorId,
    tracer?: ITracer,
    requestId?: string,
    continuations?: ContinuationRef[],
    relayWorkerId?: string
  ): Promise<Result<boolean, DomainError>> {
    const context: IExecutionContext = { actorId, tracer, requestId };
    const runLogContext = {
      computedRunId: task.runId,
      computedTaskId: task.id,
      taskType: 'seed',
    };
    let failurePhase:
      | 'deserialize_seed_payload'
      | 'set_statement_timeout'
      | 'load_seed_table'
      | 'plan_seed'
      | 'project_activity'
      | 'acquire_locks'
      | 'execute_plan'
      | 'publish_events'
      | 'collect_dirty_seed_groups'
      | 'plan_next_stage'
      | 'enqueue_next_stage'
      | 'enqueue_stage_continuation'
      | 'mark_done' = 'deserialize_seed_payload';
    const logSeedFailure = (
      error: unknown,
      logType:
        | 'computed:worker:seed_failed'
        | 'computed:worker:seed_plan_failed' = 'computed:worker:seed_failed',
      failure?: ComputedTaskFailureClassification
    ) => {
      this.logger.error(logType, {
        taskId: task.id,
        phase: failurePhase,
        seedTableId: task.seedTableId,
        seedRecordCount: task.seedRecordIds.length,
        changedFieldCount: task.changedFieldIds.length,
        ...failure,
        ...toErrorLogFields(error),
        ...runLogContext,
      });
    };

    this.logger.debug('computed:worker:seed_start', {
      taskId: task.id,
      seedTableId: task.seedTableId,
      seedRecordCount: task.seedRecordIds.length,
      changedFieldIds: task.changedFieldIds,
      ...runLogContext,
    });

    // Deserialize seed payload to domain objects
    const seedPayloadResult = deserializeSeedPayload(task);
    if (seedPayloadResult.isErr()) {
      logSeedFailure(seedPayloadResult.error);
      await this.handleTaskFailure(task, seedPayloadResult.error.message, context);
      return err(seedPayloadResult.error);
    }

    const splitResult = await this.splitLargeSeedTask(task, context, runLogContext);
    if (splitResult.isErr()) {
      logSeedFailure(splitResult.error);
      await this.handleTaskFailure(task, splitResult.error.message, context);
      return err(splitResult.error);
    }
    if (splitResult.value) return ok(true);

    const seedData = seedPayloadResult.value;

    // Load table with fields
    failurePhase = 'load_seed_table';
    const tableResult = await this.loadActiveTableForTask({
      task,
      tableId: seedData.seedTableId,
      context,
      logContext: runLogContext,
    });
    if (tableResult.isErr()) {
      const recovered = await this.recoverFromTableLookupFailure({
        task,
        error: tableResult.error,
        context,
        logContext: runLogContext,
        referencedTableIds: [seedData.seedTableId],
      });
      if (recovered.isOk() && recovered.value === 'retried') return ok(false);
      if (recovered.isOk() && recovered.value === 'completed') return ok(true);
      if (recovered.isOk() && recovered.value === 'blocked') return ok(false);
      logSeedFailure(tableResult.error);
      await this.handleTaskFailure(task, tableResult.error.message, context);
      return err(tableResult.error);
    }
    if (tableResult.value.status !== 'loaded') {
      return ok(tableResult.value.status === 'completed');
    }

    const table = tableResult.value.table;

    // Compute the full plan from seed data
    failurePhase = 'plan_seed';
    const planResult = await this.planner.planStage(
      {
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: seedData.seedRecordIds,
        extraSeedRecords: seedData.extraSeedRecords,
        beforeImageRecords: seedData.beforeImageRecords,
        table,
        changedFieldIds: seedData.changedFieldIds,
        changeType: seedData.changeType,
        cyclePolicy: seedData.cyclePolicy,
        impact: seedData.impact
          ? {
              valueFieldIds: seedData.impact.valueFieldIds,
              linkFieldIds: seedData.impact.linkFieldIds,
            }
          : undefined,
      },
      context
    );
    if (planResult.isErr()) {
      logSeedFailure(planResult.error, 'computed:worker:seed_plan_failed');
      await this.handleTaskFailure(task, planResult.error.message, context);
      return err(planResult.error);
    }

    const plan: ComputedUpdatePlan = planResult.value;

    // A plan with edges but no steps is still executable work (propagation-only
    // orphan/delete plans); only a plan with neither is a no-op.
    if (plan.steps.length === 0 && plan.edges.length === 0) {
      this.logger.debug('computed:worker:seed_no_steps', {
        taskId: task.id,
        ...runLogContext,
      });
      const doneResult = await this.markTaskDone(task, context);
      return doneResult;
    }

    // Bound the first transaction to the stage budget; activity registration below
    // still advertises the full plan so pending targets stay visible across stages.
    // Seed tasks predate planning, so no dirty estimate exists yet; the plan's
    // own estimated complexity (steps + edges + seeds) is the adaptivity signal.
    const stageSplit = this.splitPlanForStageBudget(plan);
    const stagePlan = stageSplit.stagePlan;

    failurePhase = 'project_activity';
    const batchProgress = toComputedActivityBatch(task.orchestration);
    const activityResult = await this.outbox.registerPlannedTaskActivity(
      {
        taskId: task.id,
        baseId: plan.baseId.toString(),
        targets: resolveFieldTargetsFromPlan(plan),
        metrics: {
          estimatedComplexity: plan.estimatedComplexity,
          estimatedDirtyRecords: countSeedRecordDtos(task.seedRecordIds, task.extraSeedRecords),
          hasAllTargetRecords: hasAllTargetRecordsEdge(plan.edges),
          ...(batchProgress ? { batchProgress } : {}),
        },
      },
      context
    );
    if (activityResult.isErr()) {
      logSeedFailure(activityResult.error);
      await this.handleTaskFailure(task, activityResult.error.message, context);
      return err(activityResult.error);
    }

    // Execute the plan within a transaction. Continuations only become
    // processable after commit; see processComputedTask for the rationale.
    const stagedContinuations: ContinuationRef[] = [];
    const executeResult = await this.unitOfWork.withTransaction(context, async (txContext) => {
      failurePhase = 'set_statement_timeout';
      const timeoutResult = await this.applyTaskStatementTimeout(txContext, runLogContext);
      if (timeoutResult.isErr()) return err(timeoutResult.error);

      const run = createComputedUpdateRun({
        runId: task.runId,
        totalSteps: plan.steps.length,
        completedStepsBefore: 0,
        phase: 'async',
        taskId: task.id,
      });

      failurePhase = 'acquire_locks';
      const lockResult = await this.updater.acquireLocks(stagePlan, txContext, {
        logContext: runLogContext,
        wait: false,
      });
      if (lockResult.isErr()) return err(lockResult.error);

      failurePhase = 'execute_plan';
      // Seed tasks are always chain roots: their partial continuations carry
      // this scope forward as computed tasks.
      const ledgerScopeId = task.id;
      const stageExecution = await this.runStageWithinDirtyBudget({
        plan,
        initialSplit: stageSplit,
        context: txContext,
        run,
        ledgerScopeId,
        logContext: runLogContext,
      });
      if (stageExecution.isErr()) return err(stageExecution.error);
      const { split: finalSplit, result: stageChanges, selfReferential } = stageExecution.value;

      // Publish events for computed updates
      const events = buildComputedUpdateEvents(
        stageChanges.changesByStep,
        plan.baseId,
        task.orchestration
      );
      if (events.length > 0) {
        failurePhase = 'publish_events';
        await this.publishComputedUpdateEvents(txContext, events, {
          failed: 'computed:worker:seed_events_publish_failed',
          published: 'computed:worker:seed_events_published',
          deferred: 'computed:worker:seed_events_publish_deferred',
          logContext: runLogContext,
        });
      }

      const stageContinuationFieldIds = collectContinuationFieldIdsFromExecutedSteps(
        plan,
        finalSplit.stagePlan.steps,
        stageChanges.changesByStep,
        stageChanges.rejectedCells
      );

      const settleResult = await this.settleStage({
        task,
        plan,
        finalSplit,
        stageChanges,
        continuationFieldIds: stageContinuationFieldIds,
        selfReferential,
        runId: run.runId,
        ledgerScopeId,
        originRunIds: [...run.originRunIds],
        runTotalSteps: plan.steps.length,
        runCompletedStepsBefore: 0,
        stageDepth: 0,
        sourceChangedAt: task.sourceChangedAt,
        orchestration: task.orchestration,
        context: txContext,
        logContext: runLogContext,
        continuations: stagedContinuations,
        relayWorkerId,
        setPhase: (phase) => {
          failurePhase = phase;
        },
      });
      if (settleResult.isErr()) return err(settleResult.error);
      if (settleResult.value.kind === 'done') return ok(settleResult.value.processed);
      const { seedGroups, seedAllTableIds } = settleResult.value;

      // Plan next stage if needed
      // If there are no cross-record propagation edges, the plan is purely same-record
      // (e.g. same-table formula chains) and should not enqueue follow-up stages.
      if (plan.edges.length === 0) {
        const doneResult = await this.markTaskDone(
          task,
          txContext,
          stageChanges.rejectedCells,
          toRunHistoryPlan(plan)
        );
        if (doneResult.isErr()) return err(doneResult.error);
        if (!doneResult.value) return ok(false);
        return ok(true);
      }
      failurePhase = 'plan_next_stage';
      const nextPlanResult = await this.planNextStage(
        plan,
        txContext,
        stageContinuationFieldIds,
        seedGroups,
        seedAllTableIds,
        stageChanges.changesByStep
      );
      if (nextPlanResult.isErr()) return err(nextPlanResult.error);

      // Enqueue next stage if there is more work (steps, or propagation-only edges)
      // Seed tasks start at depth 0, so the first follow-up is depth 1
      if (nextPlanResult.value.steps.length > 0 || nextPlanResult.value.edges.length > 0) {
        const nextTask = buildOutboxTaskInput({
          plan: nextPlanResult.value,
          dirtyStats: seedGroups.map((group) => ({
            tableId: group.tableId.toString(),
            recordCount: group.recordIds.length,
          })),
          syncMaxLevel: 0,
          hasher: this.hasher,
          runId: run.runId,
          originRunIds: [...run.originRunIds],
          runTotalSteps: plan.steps.length + nextPlanResult.value.steps.length,
          runCompletedStepsBefore: plan.steps.length,
          stageDepth: 1,
          sourceChangedAt: task.sourceChangedAt,
          predecessorTaskId: task.id,
          sourceFieldIds: sourceFieldIdsOf(task),
          orchestration: task.orchestration,
        });

        failurePhase = 'enqueue_next_stage';
        const enqueueResult = await this.outbox.enqueueOrMerge(
          nextTask,
          txContext,
          relayWorkerId
            ? { relayClaim: { workerId: relayWorkerId, predecessorTaskId: task.id } }
            : undefined
        );
        if (enqueueResult.isErr()) return err(enqueueResult.error);
        stagedContinuations.push({
          taskId: enqueueResult.value.taskId,
          ...(enqueueResult.value.claimed ? { claimed: enqueueResult.value.claimed } : {}),
        });
      }

      // Mark seed task as done
      failurePhase = 'mark_done';
      const doneResult = await this.markTaskDone(
        task,
        txContext,
        stageChanges.rejectedCells,
        toRunHistoryPlan(plan)
      );
      if (doneResult.isErr()) return err(doneResult.error);
      if (!doneResult.value) return ok(false);

      return ok(true);
    });

    if (executeResult.isOk() && continuations) {
      pushAll(continuations, stagedContinuations);
    }
    if (executeResult.isErr()) {
      if (isComputedUpdateLockUnavailable(executeResult.error)) {
        await this.releaseTaskForRetry(
          task,
          executeResult.error.message,
          context,
          this.outboxConfig.lockUnavailableRetryDelayMs
        );
        return ok(false);
      }
      const recovered = await this.recoverFromTableLookupFailure({
        task,
        error: executeResult.error,
        context,
        logContext: runLogContext,
        referencedTableIds: [seedData.seedTableId],
      });
      if (recovered.isErr()) {
        logSeedFailure(recovered.error, 'computed:worker:seed_failed');
        await this.handleTaskFailure(task, recovered.error.message, context);
        return err(recovered.error);
      }
      if (recovered.value === 'retried') return ok(false);
      if (recovered.value === 'completed') return ok(true);
      if (recovered.value === 'blocked') return ok(false);
      const failure = classifyComputedTaskFailure(executeResult.error);
      logSeedFailure(executeResult.error, 'computed:worker:seed_failed', failure);
      await this.handleTaskFailure(task, executeResult.error.message, context, {
        forceDeadLetter: !failure.retryable,
        failure,
        diagnostics: buildFailureDiagnostics(executeResult.error, failure, failurePhase),
      });
      return err(executeResult.error);
    }

    this.logger.debug('computed:worker:seed_done', {
      taskId: task.id,
      seedTableId: task.seedTableId,
      stepCount: plan.steps.length,
      ...runLogContext,
    });

    return ok(executeResult.value);
  }

  private splitPlanForStageBudget(
    plan: ComputedUpdatePlan,
    dirtyStats?: ReadonlyArray<{ recordCount: number }>,
    options?: { forceOneLevelClamp?: boolean }
  ): ComputedStagePlanSplit {
    const dirtyRecordEstimate = (dirtyStats ?? []).reduce(
      (sum, group) => sum + Math.max(0, group.recordCount),
      0
    );
    const baseBudget = {
      maxSteps: this.outboxConfig.stageMaxSteps,
      maxFields: this.outboxConfig.stageMaxFields,
      maxEdges: this.outboxConfig.stageMaxEdges,
    };
    const budget = resolveAdaptiveStageBudget(
      baseBudget,
      {
        estimatedComplexity: plan.estimatedComplexity,
        dirtyRecordEstimate,
        hasSeedAllTables: (plan.seedAllTableIds?.length ?? 0) > 0,
      },
      {
        smallRunComplexityThreshold: this.outboxConfig.stageSmallRunComplexityThreshold,
        smallRunBudgetMultiplier: this.outboxConfig.stageSmallRunBudgetMultiplier,
      }
    );
    let maxSteps = budget.maxSteps;
    // One-level-per-transaction stays the default: a partial dirty batch that
    // also writes a dependent level makes stage-wide settlement ambiguous, and
    // skipping the clamp on estimates previously broke delete/import replans
    // (T6648 / PR #2948). Tiny same-record host formula chains (T6706) and
    // explicit-seed linkTraversal updates and small inserts can skip it:
    // abort-mode overflow writes nothing, then forceOneLevelClamp restores the
    // T6609 boundary. Deletes, bulk inserts, seed-all, and non-traversal edges
    // stay clamped so intermediate stage-output collection can still drive replan.
    const skipOneLevelClamp =
      options?.forceOneLevelClamp !== true &&
      (shouldSkipOneLevelClamp(plan, dirtyRecordEstimate) ||
        !shouldClampToOneDependencyLevel(plan, {
          dirtyRecordEstimate,
          stageMaxDirtyRecords: this.outboxConfig.stageMaxDirtyRecords,
        }));
    if (!skipOneLevelClamp && this.outboxConfig.stageMaxDirtyRecords > 0 && plan.steps.length > 1) {
      const firstLevel = Math.min(...plan.steps.map((step) => step.level));
      const firstLevelStepCount = plan.steps.filter((step) => step.level === firstLevel).length;
      const hasLaterLevel = plan.steps.some((step) => step.level > firstLevel);
      if (hasLaterLevel) {
        // A partial dirty batch commits only a subset of the current level's
        // records. Executing a dependent level in that same transaction makes
        // its stage-wide settlement ambiguous: earlier batches may have changed
        // an upstream field while only the final batch's downstream values are
        // current. Commit one dependency level completely before the next one.
        maxSteps = maxSteps > 0 ? Math.min(maxSteps, firstLevelStepCount) : firstLevelStepCount;
      }
    }
    return splitComputedPlanForStageBudget(plan, {
      maxSteps,
      maxFields: budget.maxFields,
      maxEdges: budget.maxEdges,
    });
  }

  /**
   * Execute a stage under the dirty-record budget. When propagation aborts over
   * budget (no steps ran), retry with half as many steps until the stage fits.
   * A single-step stage runs unguarded: its fan-out cannot be reduced here, and
   * seed splitting plus statement timeouts remain the caps for that case.
   */
  private async runStageWithinDirtyBudget(params: {
    plan: ComputedUpdatePlan;
    initialSplit: ComputedStagePlanSplit;
    context: IExecutionContext;
    run: ComputedUpdateRunContext;
    /** Stage-ledger scope: the continuation chain's root task id. */
    ledgerScopeId: string;
    logContext: Record<string, unknown>;
  }): Promise<
    Result<
      {
        split: ComputedStagePlanSplit;
        result: ComputedUpdateResult;
        selfReferential: boolean;
      },
      DomainError
    >
  > {
    const maxDirtyRecords = this.outboxConfig.stageMaxDirtyRecords;
    let split = params.initialSplit;
    for (;;) {
      const stepCount = split.stagePlan.steps.length;
      if (maxDirtyRecords <= 0) {
        const result = await this.updater.execute(split.stagePlan, params.context, params.run, {
          ...ASYNC_COMPUTED_EXECUTE_OPTIONS,
          // Continuations may still carry stage-ledger state (e.g. after a
          // budget config change); the ledger frontier must drain even
          // unbudgeted.
          ledgerScopeId: params.ledgerScopeId,
        });
        if (result.isErr()) return err(result.error);
        return ok({ split, result: result.value, selfReferential: false });
      }

      if (stepCount <= 1) {
        // Floor: batch the single step by target records — a record's computed value
        // depends only on its own sources, so executing a partial dirty set is safe.
        // Self-referential plans (the floor table feeds itself) additionally carry
        // this batch's processed rows as next-batch seeds (the frontier), so later
        // generations stay reachable while the exclusion set keeps every batch's
        // budget slots reserved for genuinely-new rows.
        const floorTableKey = split.stagePlan.steps[0]?.tableId.toString();
        const selfReferential = split.stagePlan.edges.some(
          (edge) => edge.fromTableId.toString() === floorTableKey
        );
        if (selfReferential) {
          this.logger.info('computed:worker:stage_dirty_budget_floor_self_referential', {
            maxDirtyRecords,
            ...params.logContext,
          });
        }
        // Enter the queue regime before the first partial batch: explicit seeds
        // migrate into the run ledger's frontier queue HEAD, so every batch —
        // including the first — stays inside the shared stageMaxDirtyRecords
        // pool (the batch seeds only the queue's budget-bounded head; retirement
        // follows the consumed-head seq rule). The push is part of the stage
        // transaction: it rolls back with a failed batch and is idempotent on
        // retry via the ledger's primary key.
        const migratedSeedGroups = mergeComputedSeedGroups(
          split.stagePlan.seedRecordIds.length > 0
            ? [
                {
                  tableId: split.stagePlan.seedTableId,
                  recordIds: split.stagePlan.seedRecordIds,
                },
              ]
            : [],
          split.stagePlan.extraSeedRecords
        );
        let floorSplit: ComputedStagePlanSplit = split;
        if (migratedSeedGroups.length > 0) {
          const pushResult = await this.updater.pushStageLedgerFrontierSeeds(
            params.context,
            params.ledgerScopeId,
            migratedSeedGroups
          );
          if (pushResult.isErr()) return err(pushResult.error);
          this.logger.debug('computed:worker:seeds_migrated_to_ledger', {
            ledgerScopeId: params.ledgerScopeId,
            migratedSeedGroups: migratedSeedGroups.map((group) => ({
              tableId: group.tableId.toString(),
              recordIds: group.recordIds.map((recordId) => recordId.toString()),
            })),
            ...params.logContext,
          });
          floorSplit = {
            ...split,
            stagePlan: {
              ...split.stagePlan,
              seedRecordIds: [],
              extraSeedRecords: [],
            },
          };
        }
        const result = await this.updater.execute(
          floorSplit.stagePlan,
          params.context,
          params.run,
          {
            ...ASYNC_COMPUTED_EXECUTE_OPTIONS,
            maxDirtyRecords,
            dirtyBudgetMode: 'partial' as const,
            ledgerScopeId: params.ledgerScopeId,
          }
        );
        if (result.isErr()) return err(result.error);
        return ok({ split: floorSplit, result: result.value, selfReferential });
      }

      const result = await this.updater.execute(split.stagePlan, params.context, params.run, {
        ...ASYNC_COMPUTED_EXECUTE_OPTIONS,
        maxDirtyRecords,
        dirtyBudgetMode: 'abort',
        ledgerScopeId: params.ledgerScopeId,
      });
      if (result.isErr()) return err(result.error);
      const dirtyBudget = result.value.dirtyBudget;
      if (dirtyBudget?.status !== 'exceeded') {
        return ok({ split, result: result.value, selfReferential: false });
      }

      const executedLevels = new Set(split.stagePlan.steps.map((step) => step.level));
      if (executedLevels.size > 1) {
        this.logger.info('computed:worker:stage_dirty_budget_reclamp', {
          stepCount,
          maxDirtyRecords,
          dirtyRecordsAtAbort: dirtyBudget.dirtyRecordsAtAbort,
          ...params.logContext,
        });
        split = this.splitPlanForStageBudget(params.plan, undefined, { forceOneLevelClamp: true });
        continue;
      }

      const shrinkBudget = {
        maxSteps: Math.max(1, Math.floor(stepCount / 2)),
        maxFields: this.outboxConfig.stageMaxFields,
        maxEdges: this.outboxConfig.stageMaxEdges,
      };
      this.logger.info('computed:worker:stage_dirty_budget_shrink', {
        stepCount,
        nextMaxSteps: shrinkBudget.maxSteps,
        maxDirtyRecords,
        dirtyRecordsAtAbort: dirtyBudget.dirtyRecordsAtAbort,
        ...params.logContext,
      });
      split = splitComputedPlanForStageBudget(params.plan, shrinkBudget);
    }
  }

  /**
   * Shared stage settlement for both worker task kinds: collect the stage's dirty
   * outputs and finish partial batches and deferred continuations in place. Returns
   * 'continue' with the merged seed groups when the caller should proceed to its
   * own next-stage planning.
   */
  private async settleStage(params: {
    task: AnyOutboxItem;
    plan: ComputedUpdatePlan;
    finalSplit: ComputedStagePlanSplit;
    stageChanges: ComputedUpdateResult;
    /** Actual output fields accumulated across every partial batch in this stage. */
    continuationFieldIds: ReadonlyArray<FieldId>;
    selfReferential: boolean;
    /** Collect scope when the stage ran whole (no deferral, no partial batch). */
    fallbackCollectTableIds?: ReadonlyArray<TableId>;
    runId: string;
    /** Stage-ledger scope: the continuation chain's root task id. */
    ledgerScopeId: string;
    originRunIds: ReadonlyArray<string>;
    runTotalSteps: number;
    /** Run progress before this stage executed. */
    runCompletedStepsBefore: number;
    stageDepth: number;
    /** Earliest source-mutation time, carried to continuations for lineage. */
    sourceChangedAt?: Date;
    orchestration?: ComputedRealtimeOrchestrationDto;
    context: IExecutionContext;
    logContext: Record<string, unknown>;
    continuations?: ContinuationRef[];
    /** When set, stage continuations are relay-claimed for this worker. */
    relayWorkerId?: string;
    setPhase: (
      phase: 'collect_dirty_seed_groups' | 'enqueue_stage_continuation' | 'mark_done'
    ) => void;
  }): Promise<
    Result<
      | { kind: 'done'; processed: boolean }
      | {
          kind: 'continue';
          seedGroups: ComputedSeedGroup[];
          seedAllTableIds: TableId[];
          completedStepsAfter: number;
        },
      DomainError
    >
  > {
    const { finalSplit, stageChanges, plan } = params;
    const finalStagePlan = finalSplit.stagePlan;
    const partialOutcome =
      stageChanges.dirtyBudget?.status === 'partial' ? stageChanges.dirtyBudget : undefined;
    const completedStepsAfter =
      params.runCompletedStepsBefore + (partialOutcome ? 0 : finalStagePlan.steps.length);

    params.setPhase('collect_dirty_seed_groups');
    // Stage OUTPUT tables: step tables plus propagation target tables. Edge-only
    // stages (orphan-edge continuations) have no steps at all — their outputs
    // live entirely in the edges' target tables, which must still feed the
    // exclusion ledger (partial batches) and the completed-stage collection.
    const stageStepTables = [
      ...new Map([
        ...finalStagePlan.steps.map((step) => [step.tableId.toString(), step.tableId] as const),
        ...finalStagePlan.edges.map((edge) => [edge.toTableId.toString(), edge.toTableId] as const),
      ]).values(),
    ];
    // Whole-table SOURCE progress is tracked by per-table cursors (advanced only
    // when the slice's propagation completed), so the exclusion ledger only ever
    // holds processed TARGET rows from the stage's step tables.
    const propagationTruncated =
      partialOutcome !== undefined &&
      (partialOutcome.truncated === 'propagation' || partialOutcome.truncated === 'both');
    // One lifecycle decision drives frontier retirement AND collection: while
    // deferred edge chunks remain, consumed sources carry forward.
    const settlementMode = finalSplit.deferred !== null ? 'carry-sources' : 'stage-final';

    if (partialOutcome) {
      // The frontier is a seq-ordered queue in the run ledger: each batch seeds
      // only its budget-bounded HEAD. If propagation completed, exactly the
      // consumed head retires; otherwise the queue stays (the head re-seeds next
      // batch and progresses via target exclusions). Settlement is SQL-side —
      // no record ids cross into JS:
      // - self-referential stages append rows NEW this batch (dirty step-table
      //   rows not yet excluded) to the queue tail;
      // - every processed step-table row joins the exclusion ledger.
      const ledgerResult = await this.updater.settleStageLedgerPartialBatch(params.context, {
        scopeId: params.ledgerScopeId,
        stepTableIds: stageStepTables,
        appendFrontier: params.selfReferential,
        retireFrontierUpToSeq:
          !propagationTruncated && partialOutcome.frontierMaxSeq !== undefined
            ? partialOutcome.frontierMaxSeq
            : null,
        settlementMode,
      });
      if (ledgerResult.isErr()) return err(ledgerResult.error);
      // Whole-table seeding progress: cursors advance only once the slice's
      // propagation completed; a truncated slice re-seeds from the old cursor.
      const seedAllCursors = propagationTruncated
        ? plan.seedAllCursors
        : partialOutcome.seedAllCursors ?? plan.seedAllCursors;
      // Normalize every whole-table-seeded source (explicit seed-all and the
      // implicit schema-update case alike, as reported by the batch itself) to
      // explicit seedAllTableIds: continuations must not re-derive the implicit
      // classification once seeds have migrated into the frontier queue.
      const wholeTableSeedTables = mergeSeedAllTableIdLists(
        plan.seedAllTableIds ?? [],
        partialOutcome.wholeTableSeedTables ?? []
      );
      const finishResult = await this.finishStageWithPartialBatch({
        task: params.task,
        setPhase: params.setPhase,
        plan,
        continuations: params.continuations,
        relayWorkerId: params.relayWorkerId,
        affectedFieldIds: params.continuationFieldIds.map((fieldId) => fieldId.toString()),
        processedStats: ledgerResult.value.processedByTable,
        ledgerStats: {
          newFrontierRows: ledgerResult.value.newFrontierRows,
          retiredFrontierRows: ledgerResult.value.retiredFrontierRows,
        },
        seedAllTableIds: wholeTableSeedTables,
        seedAllCursors,
        runId: params.runId,
        ledgerScopeId: params.ledgerScopeId,
        originRunIds: params.originRunIds,
        runTotalSteps: params.runTotalSteps,
        runCompletedStepsBefore: completedStepsAfter,
        stageDepth: params.stageDepth,
        sourceChangedAt: params.sourceChangedAt,
        orchestration: params.orchestration,
        context: params.context,
        logContext: params.logContext,
        rejectedCells: stageChanges.rejectedCells,
      });
      if (finishResult.isErr()) return err(finishResult.error);
      return ok({ kind: 'done', processed: finishResult.value });
    }

    // Stage completed. Records processed by earlier partial batches are real
    // dirty outputs of the stage and re-enter follow-up planning as seeds. The
    // collection runs over the union of the dirty temp table and the exclusion
    // ledger WITHOUT materializing it anywhere (no fold back into the
    // transaction), keeping the final batch inside the dirty budget; per-table
    // counts pick seed-all vs exact-id representation and the total exact ids
    // are hard-capped. The stage's ledger state drops with it.
    // Stages with deferred work also collect the deferred edges' SOURCE tables:
    // preserved consumed sources (and any still-dirty source rows) must seed the
    // continuation, or edge chunks after the first would propagate from nothing.
    const deferredSourceTables = finalSplit.deferred
      ? [
          ...new Map(
            finalSplit.deferred.edges.map(
              (edge) => [edge.fromTableId.toString(), edge.fromTableId] as const
            )
          ).values(),
        ]
      : [];
    const dirtyCollectionTableIds = finalSplit.deferred
      ? [
          ...new Map(
            [...stageStepTables, ...deferredSourceTables].map(
              (tableId) => [tableId.toString(), tableId] as const
            )
          ).values(),
        ]
      : params.fallbackCollectTableIds ?? stageStepTables;
    const seedGroupsResult = await this.updater.collectStageOutputSeedGroups(params.context, {
      scopeId: params.ledgerScopeId,
      tableIds: dirtyCollectionTableIds,
      seedAllThreshold: this.outboxConfig.stageSeedAllThreshold || undefined,
      exactIdsTotalCap: this.outboxConfig.stageMaxCollectedSeedIds,
      settlementMode,
    });
    if (seedGroupsResult.isErr()) return err(seedGroupsResult.error);
    const { groups: seedGroups, seedAllTableIds } = seedGroupsResult.value;
    const clearResult = await this.updater.clearTaskStageLedger(
      params.context,
      params.ledgerScopeId
    );
    if (clearResult.isErr()) return err(clearResult.error);

    if (finalSplit.deferred) {
      const finishResult = await this.finishStageWithContinuation({
        task: params.task,
        setPhase: params.setPhase,
        plan,
        deferred: finalSplit.deferred,
        seedGroups,
        seedAllTableIds,
        runId: params.runId,
        originRunIds: params.originRunIds,
        runTotalSteps: params.runTotalSteps,
        runCompletedStepsBefore: completedStepsAfter,
        stageDepth: params.stageDepth,
        sourceChangedAt: params.sourceChangedAt,
        orchestration: params.orchestration,
        context: params.context,
        logContext: params.logContext,
        continuations: params.continuations,
        relayWorkerId: params.relayWorkerId,
        rejectedCells: stageChanges.rejectedCells,
      });
      if (finishResult.isErr()) return err(finishResult.error);
      return ok({ kind: 'done', processed: finishResult.value });
    }

    return ok({ kind: 'continue', seedGroups, seedAllTableIds, completedStepsAfter });
  }

  /**
   * Shared tail for a partial floor batch: the batch's outputs are already in
   * the run ledger (SQL-side settlement), so the continuation is the same plan
   * with only O(1) durable state — seed-all tables, cursors, and the lineage
   * hash. The step is not complete, so run progress does not advance.
   */
  private async finishStageWithPartialBatch(params: {
    continuations?: ContinuationRef[];
    /** When set, the continuation is relay-claimed for this worker. */
    relayWorkerId?: string;
    task: AnyOutboxItem;
    setPhase: (phase: 'enqueue_stage_continuation' | 'mark_done') => void;
    plan: ComputedUpdatePlan;
    /** Bounded by schema width; never grows with the stage's record fan-out. */
    affectedFieldIds: ReadonlyArray<string>;
    /** Per-table processed counts from the batch's ledger settlement. */
    processedStats: ReadonlyArray<{ tableId: string; recordCount: number }>;
    /** Ledger movement counts, logged for observability. */
    ledgerStats?: { newFrontierRows: number; retiredFrontierRows: number };
    /** Whole-table seed tables, normalized to explicit form on continuations. */
    seedAllTableIds?: ReadonlyArray<TableId>;
    /** Whole-table seeding resume cursors to persist on the continuation. */
    seedAllCursors?: Readonly<Record<string, string>>;
    runId: string;
    /** Stage-ledger scope carried to the continuation so the chain stays keyed. */
    ledgerScopeId: string;
    originRunIds: ReadonlyArray<string>;
    runTotalSteps: number;
    runCompletedStepsBefore: number;
    stageDepth: number;
    /** Earliest source-mutation time, carried to the continuation for lineage. */
    sourceChangedAt?: Date;
    orchestration?: ComputedRealtimeOrchestrationDto;
    context: IExecutionContext;
    logContext: Record<string, unknown>;
    rejectedCells?: ReadonlyArray<ComputedCellLimitRejection>;
  }): Promise<Result<boolean, DomainError>> {
    params.setPhase('enqueue_stage_continuation');
    const seedAllTableIds = params.seedAllTableIds ?? params.plan.seedAllTableIds;
    const continuationPlan: ComputedUpdatePlan = {
      ...params.plan,
      ledgerScopeId: params.ledgerScopeId,
      seedAllTableIds: seedAllTableIds && seedAllTableIds.length > 0 ? seedAllTableIds : undefined,
      seedAllCursors: params.seedAllCursors,
      // Explicit seeds live in the ledger queue (or retired with it) on partial
      // batches.
      seedRecordIds: [],
      extraSeedRecords: [],
    };
    const builtTask = buildOutboxTaskInput({
      plan: continuationPlan,
      dirtyStats: [...params.processedStats],
      syncMaxLevel: 0,
      hasher: this.hasher,
      runId: params.runId,
      originRunIds: [...params.originRunIds],
      runTotalSteps: params.runTotalSteps,
      runCompletedStepsBefore: params.runCompletedStepsBefore,
      stageDepth: params.stageDepth,
      sourceChangedAt: params.sourceChangedAt,
      predecessorTaskId: params.task.id,
      orchestration: params.orchestration,
      sourceFieldIds: sourceFieldIdsOf(params.task),
      affectedFieldIds: [...params.affectedFieldIds],
    });
    const nextTask = {
      ...builtTask,
      planHash: buildContinuationPlanHash(builtTask.planHash, {
        runId: params.runId,
        stageIndex: params.runCompletedStepsBefore,
        predecessorTaskId: params.task.id,
      }),
    };

    const enqueueResult = await this.outbox.enqueueOrMerge(
      nextTask,
      params.context,
      params.relayWorkerId
        ? { relayClaim: { workerId: params.relayWorkerId, predecessorTaskId: params.task.id } }
        : undefined
    );
    if (enqueueResult.isErr()) return err(enqueueResult.error);
    params.continuations?.push({
      taskId: enqueueResult.value.taskId,
      ...(enqueueResult.value.claimed ? { claimed: enqueueResult.value.claimed } : {}),
    });

    this.logger.info('computed:worker:stage_partial_batch_enqueued', {
      continuationTaskId: enqueueResult.value.taskId,
      processedRecordCount: params.processedStats.reduce(
        (sum, group) => sum + group.recordCount,
        0
      ),
      newFrontierRows: params.ledgerStats?.newFrontierRows,
      retiredFrontierRows: params.ledgerStats?.retiredFrontierRows,
      ...params.logContext,
    });

    params.setPhase('mark_done');
    const doneResult = await this.markTaskDone(
      params.task,
      params.context,
      params.rejectedCells,
      toRunHistoryPlan(params.plan)
    );
    if (doneResult.isErr()) return err(doneResult.error);
    return ok(doneResult.value);
  }

  /**
   * Shared tail for both worker task kinds: enqueue the stage continuation and mark
   * the current task done inside the caller's transaction. Returns markDone's outcome.
   */
  private async finishStageWithContinuation(
    params: Omit<
      Parameters<ComputedUpdateWorker['enqueueStageContinuation']>[0],
      'predecessorTaskId'
    > & {
      task: AnyOutboxItem;
      setPhase: (phase: 'enqueue_stage_continuation' | 'mark_done') => void;
      rejectedCells?: ReadonlyArray<ComputedCellLimitRejection>;
    }
  ): Promise<Result<boolean, DomainError>> {
    params.setPhase('enqueue_stage_continuation');
    const continuationResult = await this.enqueueStageContinuation({
      ...params,
      predecessorTaskId: params.task.id,
      sourceFieldIds: sourceFieldIdsOf(params.task),
    });
    if (continuationResult.isErr()) return err(continuationResult.error);

    params.setPhase('mark_done');
    const doneResult = await this.markTaskDone(
      params.task,
      params.context,
      params.rejectedCells,
      toRunHistoryPlan(params.plan)
    );
    if (doneResult.isErr()) return err(doneResult.error);
    return ok(doneResult.value);
  }

  /**
   * Enqueue the deferred remainder of a budget-split plan as a follow-up outbox task.
   * Must run inside the same transaction that commits the executed stage and marks the
   * current task done, so the continuation exists iff the stage's writes are durable.
   */
  private async enqueueStageContinuation(params: {
    continuations?: ContinuationRef[];
    /** When set, the continuation is relay-claimed for this worker. */
    relayWorkerId?: string;
    plan: ComputedUpdatePlan;
    deferred: NonNullable<ComputedStagePlanSplit['deferred']>;
    seedGroups: ReadonlyArray<ComputedSeedGroup>;
    seedAllTableIds: ReadonlyArray<TableId>;
    runId: string;
    originRunIds: ReadonlyArray<string>;
    runTotalSteps: number;
    runCompletedStepsBefore: number;
    stageDepth: number;
    /** Earliest source-mutation time, carried to the continuation for lineage. */
    sourceChangedAt?: Date;
    sourceFieldIds?: ReadonlyArray<string>;
    predecessorTaskId: string;
    orchestration?: ComputedRealtimeOrchestrationDto;
    context: IExecutionContext;
    logContext: Record<string, unknown>;
  }): Promise<Result<void, DomainError>> {
    const continuationPlan = buildDeferredStagePlan({
      plan: params.plan,
      deferred: params.deferred,
      dirtySeedGroups: params.seedGroups,
      dirtySeedAllTableIds: params.seedAllTableIds,
    });

    const builtTask = buildOutboxTaskInput({
      plan: continuationPlan,
      dirtyStats: params.seedGroups.map((group) => ({
        tableId: group.tableId.toString(),
        recordCount: group.recordIds.length,
      })),
      syncMaxLevel: 0,
      hasher: this.hasher,
      runId: params.runId,
      originRunIds: [...params.originRunIds],
      // Field-split stages can execute more step-slices than the original plan
      // counted; keep the total ahead of completed so progress never overflows.
      runTotalSteps: Math.max(
        params.runTotalSteps,
        params.runCompletedStepsBefore + params.deferred.steps.length
      ),
      runCompletedStepsBefore: params.runCompletedStepsBefore,
      stageDepth: params.stageDepth,
      sourceChangedAt: params.sourceChangedAt,
      predecessorTaskId: params.predecessorTaskId,
      sourceFieldIds: params.sourceFieldIds,
      orchestration: params.orchestration,
    });
    const nextTask = {
      ...builtTask,
      planHash: buildContinuationPlanHash(builtTask.planHash, {
        runId: params.runId,
        stageIndex: params.runCompletedStepsBefore,
        predecessorTaskId: params.predecessorTaskId,
      }),
    };

    const enqueueResult = await this.outbox.enqueueOrMerge(
      nextTask,
      params.context,
      params.relayWorkerId
        ? {
            relayClaim: {
              workerId: params.relayWorkerId,
              predecessorTaskId: params.predecessorTaskId,
            },
          }
        : undefined
    );
    if (enqueueResult.isErr()) return err(enqueueResult.error);
    params.continuations?.push({
      taskId: enqueueResult.value.taskId,
      ...(enqueueResult.value.claimed ? { claimed: enqueueResult.value.claimed } : {}),
    });

    this.logger.info('computed:worker:stage_continuation_enqueued', {
      continuationTaskId: enqueueResult.value.taskId,
      merged: enqueueResult.value.merged,
      executedSteps: params.runCompletedStepsBefore,
      deferredSteps: params.deferred.steps.length,
      deferredEdges: params.deferred.edges.length,
      continuationSeedGroups: continuationPlan.extraSeedRecords.length,
      continuationSeedAllTables: continuationPlan.seedAllTableIds?.length ?? 0,
      ...params.logContext,
    });
    return ok(undefined);
  }

  private async planNextStage(
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    seedFieldIds: ReadonlyArray<FieldId>,
    seedGroups: ReadonlyArray<ComputedSeedGroup>,
    seedAllTableIds?: ReadonlyArray<TableId>,
    changesByStep: ReadonlyArray<StepChangeData> = []
  ): Promise<Result<ComputedUpdatePlan, DomainError>> {
    // NOTE: do NOT shortcut on plan.edges being empty. Budget-split stages can
    // execute a step whose outgoing edges were assigned to a SIBLING stage
    // (e.g. a link-title edge classified as orphan because its hosting step
    // lives outside this task), so an edge-less stage's changes may still have
    // cross-record downstream work that only a fresh planner pass can see.
    if (seedFieldIds.length === 0 && (!seedAllTableIds || seedAllTableIds.length === 0))
      return ok({ ...plan, steps: [], edges: [] });

    const seedSplit = splitSeedGroupsForPlan(seedGroups, plan.seedTableId);
    if (!seedSplit && (!seedAllTableIds || seedAllTableIds.length === 0))
      return ok({ ...plan, steps: [], edges: [] });

    // Prefer step-change snapshots for this stage, but always carry forward any
    // before-image already on the plan (e.g. filter-field values from the original
    // user mutation). Dropping them forces conditional edges into allTargetRecords.
    let beforeImageRecords: ComputedUpdatePlan['beforeImageRecords'] = [
      ...(plan.beforeImageRecords ?? []),
    ];
    if (seedSplit && changesByStep.length > 0) {
      const tableSpec = TableByIdSpec.create(seedSplit.seedTableId);
      const tableResult = await this.tableRepository.findOne(context, tableSpec);
      if (tableResult.isErr()) return err(tableResult.error);

      const beforeImageResult = buildBeforeImageRecordsFromStepChanges({
        seedTableId: seedSplit.seedTableId,
        seedRecordIds: seedSplit.seedRecordIds,
        seedFieldIds,
        changesByStep,
        tableById: new Map([[seedSplit.seedTableId.toString(), tableResult.value]]),
      });
      if (beforeImageResult.isErr()) return err(beforeImageResult.error);
      beforeImageRecords = mergeBeforeImageRecords(beforeImageRecords, beforeImageResult.value);
    }

    const startTime = Date.now();
    const result = await this.planner.planStage(
      {
        baseId: plan.baseId,
        seedTableId: seedSplit?.seedTableId ?? plan.seedTableId,
        seedRecordIds: seedSplit?.seedRecordIds ?? [],
        extraSeedRecords: seedSplit?.extraSeedRecords ?? [],
        beforeImageRecords,
        changedFieldIds: seedFieldIds,
        // After the initial insert/delete is processed, subsequent stages should behave like
        // updates. Follow-up stages are recomputing surviving records based on computed-field
        // changes, not replaying the original row deletion/insertion semantics.
        changeType:
          plan.changeType === 'insert' || plan.changeType === 'delete' ? 'update' : plan.changeType,
        cyclePolicy: plan.cyclePolicy,
        impact: {
          valueFieldIds: seedFieldIds,
          linkFieldIds: [],
        },
      },
      context
    );

    const elapsedMs = Date.now() - startTime;
    if (result.isOk() && (elapsedMs > 100 || result.value.steps.length > 0)) {
      this.logger.debug('computed:worker:planNextStage', {
        elapsedMs,
        inputSeedFieldIds: seedFieldIds.length,
        inputSeedGroups: seedGroups.length,
        inputSeedRecords: seedGroups.reduce((acc, g) => acc + g.recordIds.length, 0),
        inputSeedAllTableIds: seedAllTableIds?.length ?? 0,
        outputSteps: result.value.steps.length,
        outputEdges: result.value.edges.length,
        seedTableId: (seedSplit?.seedTableId ?? plan.seedTableId).toString(),
      });
    }

    // Carry seedAllTableIds through to the next plan
    if (result.isOk() && seedAllTableIds && seedAllTableIds.length > 0) {
      return ok({ ...result.value, seedAllTableIds });
    }

    return result;
  }
}

const toPayload = (task: ComputedUpdateOutboxItem): ComputedUpdateOutboxPayload => ({
  baseId: task.baseId,
  seedTableId: task.seedTableId,
  seedRecordIds: task.seedRecordIds,
  extraSeedRecords: task.extraSeedRecords,
  beforeImageRecords: task.beforeImageRecords,
  steps: task.steps,
  sameTableBatches: task.sameTableBatches,
  edges: task.edges,
  estimatedComplexity: task.estimatedComplexity,
  changeType: task.changeType,
  seedAllTableIds: task.seedAllTableIds,
  seedAllCursors: task.seedAllCursors,
});

const collectSeedFieldIds = (
  task: ComputedUpdateOutboxItem
): Result<ReadonlyArray<FieldId>, DomainError> => {
  const ids = new Map<string, FieldId>();
  const candidates = task.affectedFieldIds.length ? task.affectedFieldIds : [];

  for (const fieldId of candidates) {
    const parsed = FieldId.create(fieldId);
    if (parsed.isErr()) return err(parsed.error);
    ids.set(parsed.value.toString(), parsed.value);
  }

  if (ids.size > 0) return ok([...ids.values()]);

  for (const step of task.steps) {
    for (const fieldId of step.fieldIds) {
      const parsed = FieldId.create(fieldId);
      if (parsed.isErr()) return err(parsed.error);
      ids.set(parsed.value.toString(), parsed.value);
    }
  }
  if (ids.size === 0) {
    // Edge-only tasks carry no step fields: their propagation targets are the
    // stage's outputs and must still drive downstream planning.
    for (const edge of task.edges) {
      for (const rawFieldId of edge.propagationTargetFieldIds ?? [edge.toFieldId]) {
        const parsed = FieldId.create(rawFieldId);
        if (parsed.isErr()) return err(parsed.error);
        ids.set(parsed.value.toString(), parsed.value);
      }
    }
  }

  return ok([...ids.values()]);
};

/**
 * Union this batch's real outputs with outputs carried by earlier partial
 * batches of the same stage. The set is bounded by schema width and resets
 * when a new stage is planned.
 */
const collectStageContinuationFieldIds = (
  plan: ComputedUpdatePlan,
  executedSteps: ReadonlyArray<ComputedUpdatePlan['steps'][number]>,
  changesByStep: ReadonlyArray<StepChangeData>,
  carriedFieldIds: ReadonlyArray<string>,
  rejectedCells?: ReadonlyArray<ComputedCellLimitRejection>
): Result<ReadonlyArray<FieldId>, DomainError> => {
  const ids = new Map<string, FieldId>();
  for (const rawFieldId of carriedFieldIds) {
    const fieldId = FieldId.create(rawFieldId);
    if (fieldId.isErr()) return err(fieldId.error);
    ids.set(fieldId.value.toString(), fieldId.value);
  }
  for (const fieldId of collectContinuationFieldIdsFromExecutedSteps(
    plan,
    executedSteps,
    changesByStep,
    rejectedCells
  )) {
    ids.set(fieldId.toString(), fieldId);
  }
  return ok([...ids.values()]);
};

const collectSeedTableIds = (
  task: ComputedUpdateOutboxItem
): Result<ReadonlyArray<TableId>, DomainError> => {
  const ids = new Map<string, TableId>();
  const candidates = task.affectedTableIds.length ? task.affectedTableIds : [];

  for (const tableId of candidates) {
    const parsed = TableId.create(tableId);
    if (parsed.isErr()) return err(parsed.error);
    ids.set(parsed.value.toString(), parsed.value);
  }

  for (const step of task.steps) {
    const parsed = TableId.create(step.tableId);
    if (parsed.isErr()) return err(parsed.error);
    ids.set(parsed.value.toString(), parsed.value);
  }
  for (const edge of task.edges) {
    const parsed = TableId.create(edge.toTableId);
    if (parsed.isErr()) return err(parsed.error);
    ids.set(parsed.value.toString(), parsed.value);
  }

  return ok([...ids.values()]);
};

/**
 * Build RecordsBatchUpdated events from step change data.
 * Groups changes by tableId and creates one event per table.
 */
const buildComputedUpdateEvents = (
  changesByStep: ReadonlyArray<StepChangeData>,
  baseId: BaseId,
  orchestration?: ComputedUpdateOutboxItem['orchestration']
): RecordsBatchUpdated[] => {
  if (changesByStep.length === 0) return [];

  // Group changes by tableId
  const changesByTable = new Map<string, StepChangeData['recordChanges']>();
  for (const stepChange of changesByStep) {
    const existing = changesByTable.get(stepChange.tableId) ?? [];
    changesByTable.set(stepChange.tableId, [...existing, ...stepChange.recordChanges]);
  }

  const events: RecordsBatchUpdated[] = [];

  for (const [tableIdStr, recordChanges] of changesByTable) {
    if (recordChanges.length === 0) continue;

    const tableIdResult = TableId.create(tableIdStr);
    if (tableIdResult.isErr()) continue;

    // Convert recordChanges to RecordUpdateDTO format
    // Use actual oldVersion from computed update (version before update)
    const updates = recordChanges.map((change) => ({
      recordId: change.recordId,
      oldVersion: change.oldVersion,
      newVersion: change.oldVersion + 1,
      changes: change.changes.map((fieldChange) => ({
        fieldId: fieldChange.fieldId,
        oldValue: fieldChange.oldValue,
        newValue: fieldChange.newValue,
      })),
    }));

    events.push(
      RecordsBatchUpdated.create({
        tableId: tableIdResult.value,
        baseId,
        updates,
        source: 'computed',
        orchestration,
      })
    );
  }

  return events;
};

const buildComputedUpdateEventLogContext = (events: ReadonlyArray<RecordsBatchUpdated>) => ({
  eventCount: events.length,
  tableIds: [...new Set(events.map((event) => event.tableId.toString()))],
  events: events.slice(0, maxComputedEventLogItems).map((event) => {
    const fieldIds = [
      ...new Set(event.updates.flatMap((update) => update.changes.map((change) => change.fieldId))),
    ];
    const recordIds = event.updates.map((update) => update.recordId);
    return {
      tableId: event.tableId.toString(),
      recordCount: event.updates.length,
      recordIds: recordIds.slice(0, maxComputedEventLogRecordIds),
      hasMoreRecordIds: recordIds.length > maxComputedEventLogRecordIds,
      fieldIds: fieldIds.slice(0, maxComputedEventLogFieldIds),
      hasMoreFieldIds: fieldIds.length > maxComputedEventLogFieldIds,
    };
  }),
  hasMoreEvents: events.length > maxComputedEventLogItems,
});
