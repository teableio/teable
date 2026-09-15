import {
  getPostgresTransaction,
  resolvePostgresDbOrTx,
} from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  BaseId,
  ComputedActivity,
  ComputedActivityBatchChanged,
  domainError,
  emptyComputeReliability,
  FieldId,
  getUnitOfWorkTransaction,
  registerAfterCommit,
  TableId,
  type DomainError,
  type FieldComputeTarget,
  type IEventBus,
  type IExecutionContext,
  type ILogger,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { DynamicDB } from '../../query-builder';
import { buildTryAdvisoryLockQuery } from '../ComputedUpdateLock';
import { pushAll } from '../pushAll';
import { isComputedReliabilityVisible } from '../reliability/config';
import { PostgresComputedReliabilityStore } from '../reliability/PostgresComputedReliabilityStore';
import {
  fieldActivityRowToDto,
  tableActivityRowToDto,
  toNumber,
} from './ComputedActivityRowMapper';
import type {
  ComputedActivityFieldError,
  ComputedActivityProjectionResult,
  ComputedActivityTaskMetrics,
  IComputedActivityProjector,
} from './IComputedActivityProjector';

const FIELD_ACTIVITY_TABLE = 'computed_field_activity';
const TABLE_ACTIVITY_TABLE = 'computed_table_activity';
const TASK_FIELD_REF_TABLE = 'computed_task_field_ref';
const ACTIVITY_WRITE_BATCH_SIZE = 500;
// Activity projections are best-effort bookkeeping. The enqueue projection runs inside the
// caller's record-write transaction, which already holds table_meta row locks; an unbounded
// wait here (on the per-table advisory lock or on the in-process enqueue gate) can close a
// cross-connection cycle that PostgreSQL's deadlock detector cannot see: the gate holder
// blocks on the advisory lock inside its own transaction while every gate waiter sits idle
// in transaction holding the row locks the advisory-lock holder needs. Both waits are
// therefore bounded, and on timeout the projection is skipped — reconcileTable drops any
// refs that drift out of sync with the outbox.
const ACTIVITY_ADVISORY_LOCK_TIMEOUT_MS = 5_000;
// The retry delay doubles from the initial value up to the cap: the lock is normally held
// only for the few milliseconds a projection takes, so a fixed coarse interval makes every
// contended waiter pay the full quantum (and under a task convoy the waiters keep missing
// the free window, burning the whole timeout budget in 250ms slices).
const ACTIVITY_ADVISORY_LOCK_RETRY_INITIAL_DELAY_MS = 5;
const ACTIVITY_ADVISORY_LOCK_RETRY_MAX_DELAY_MS = 250;
// A healthy lock is held for the few milliseconds a projection takes; waiting a
// full backoff quantum means a convoy is forming, which is worth surfacing per
// table long before waits reach the 5s skip threshold.
const ACTIVITY_ADVISORY_LOCK_CONTENTION_LOG_THRESHOLD_MS = (() => {
  const parsed = Number(process.env.COMPUTED_ACTIVITY_LOCK_CONTENTION_LOG_THRESHOLD_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 250;
})();
// Rate-limit the contention warn to one per (operation, table) per interval. The
// first occurrence carries the convoy signal; hot tables otherwise repeat it on
// every projection (991 warns in 24h on 2026-08-26, mostly marginal ~300ms waits)
// and drown the alert channel in noise.
const ACTIVITY_ADVISORY_LOCK_CONTENTION_LOG_INTERVAL_MS = (() => {
  const parsed = Number(process.env.COMPUTED_ACTIVITY_LOCK_CONTENTION_LOG_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60_000;
})();
const ENQUEUE_PROJECTION_GATE_TIMEOUT_MS = 15_000;
// Async projection mode (default-on): lifecycle hooks write only the task-field ref
// ledger inside the caller's transaction — no advisory lock, no activity-table
// read-modify-write — and queue the event metadata for a per-table debounced
// flusher. The flusher is the single writer of the activity tables, so lock
// contention no longer scales with task count (the 2026-08-14 CN convoy). Keep
// an explicit `false` kill switch for emergency rollback to the synchronous path.
const isAsyncProjectionEnabled = () => process.env.COMPUTED_ACTIVITY_ASYNC_PROJECTION !== 'false';
const ACTIVITY_ASYNC_FLUSH_DEBOUNCE_MS = (() => {
  const parsed = Number(process.env.COMPUTED_ACTIVITY_FLUSH_DEBOUNCE_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 300;
})();
// The flusher runs on its own connection outside any caller transaction, so a
// short bounded wait is safe; on timeout the events are requeued and retried.
const ACTIVITY_ASYNC_FLUSH_LOCK_TIMEOUT_MS = 1_000;
const ACTIVITY_ASYNC_FLUSH_RETRY_INITIAL_DELAY_MS = 1_000;
const ACTIVITY_ASYNC_FLUSH_RETRY_MAX_DELAY_MS = 10_000;
// A 'finished' event whose ref delete is not yet visible means the hook's
// ledger transaction has not committed (worker paths enqueue without an
// after-commit hook); flushing now would freeze the field as running with the
// duration/error metadata already consumed. Requeue briefly instead; after the
// cap, proceed anyway so a genuinely stuck ref cannot block the queue.
const ACTIVITY_ASYNC_FLUSH_NOT_READY_DELAY_MS = 500;
const ACTIVITY_ASYNC_FLUSH_MAX_NOT_READY_RETRIES = 5;
// After this many consecutive failures the table's queued metadata is dropped:
// a flush that keeps failing usually means the pool is gone (container being
// destroyed), and counters re-derive from refs on the next healthy flush or
// read-path reconcile anyway. Without the cap a destroyed pool would be
// retried forever and pin the dead container's object graph.
const ACTIVITY_ASYNC_FLUSH_MAX_CONSECUTIVE_FAILURES = 10;
// Metadata events are diagnostics; counters always heal from refs. Under a
// runaway backlog dropping the oldest metadata is safer than unbounded memory.
const ACTIVITY_ASYNC_PENDING_EVENTS_MAX = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitWithTimeout = async (promise: Promise<void>, timeoutMs: number): Promise<boolean> => {
  if (timeoutMs <= 0) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

type DbLike = Kysely<DynamicDB> | Transaction<DynamicDB>;
type StoredActivityTarget = FieldComputeTarget & { baseId: BaseId };

// Event metadata captured at hook time for the async flusher. Counters are NOT
// carried here — they are always re-derived from persisted refs at flush time —
// only the event-borne diagnostics (durations, errors, complexity estimates)
// that reconcileTable cannot rebuild.
type PendingActivityEvent =
  | {
      kind: 'enqueued';
      baseId: BaseId;
      targets: FieldComputeTarget[];
      metrics: ComputedActivityTaskMetrics;
      at: Date;
    }
  | { kind: 'refs_changed'; targets: StoredActivityTarget[]; at: Date }
  | {
      kind: 'finished';
      taskId: string;
      baseId: BaseId;
      targets: StoredActivityTarget[];
      durationMs?: number;
      error: { code?: string; message: string } | null;
      fieldErrors?: ReadonlyArray<ComputedActivityFieldError>;
      at: Date;
    }
  | {
      kind: 'retry';
      targets: StoredActivityTarget[];
      error: { code?: string; message: string };
      at: Date;
    };

type PendingTableState = {
  events: PendingActivityEvent[];
  timer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
  retryDelayMs: number;
  consecutiveFailures: number;
  notReadyRetries: number;
  droppedEvents: number;
};

const groupTargetsByTable = <T extends Pick<FieldComputeTarget, 'tableId'>>(
  targets: ReadonlyArray<T>
): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const target of targets) {
    const key = target.tableId.toString();
    const group = groups.get(key);
    if (group) group.push(target);
    else groups.set(key, [target]);
  }
  return groups;
};

class ComputedActivityAbort extends Error {
  constructor(readonly error: DomainError) {
    super(error.message);
    this.name = 'ComputedActivityAbort';
  }
}

const storedActivityTargets = (
  rows: ReadonlyArray<Record<string, unknown>>,
  baseIdOverride?: string
): Result<StoredActivityTarget[], DomainError> => {
  const targets: StoredActivityTarget[] = [];
  for (const row of rows) {
    const target = BaseId.create(baseIdOverride ?? row.base_id).andThen((baseId) =>
      TableId.create(row.table_id).andThen((tableId) =>
        FieldId.create(row.field_id).map((fieldId) => ({ fieldId, tableId, baseId }))
      )
    );
    if (target.isErr()) return err(target.error);
    targets.push(target.value);
  }
  return ok(targets);
};

@injectable()
export class ComputedActivityProjector implements IComputedActivityProjector {
  private readonly enqueueProjectionTails = new Map<string, Promise<void>>();
  private asyncProjectionEnabled = isAsyncProjectionEnabled();
  private asyncFlushDebounceMs = ACTIVITY_ASYNC_FLUSH_DEBOUNCE_MS;
  private lockContentionLogThresholdMs = ACTIVITY_ADVISORY_LOCK_CONTENTION_LOG_THRESHOLD_MS;
  private lockContentionLogIntervalMs = ACTIVITY_ADVISORY_LOCK_CONTENTION_LOG_INTERVAL_MS;
  private readonly lockContentionLogLastAt = new Map<string, number>();
  private asyncFlusherDisposed = false;
  private readonly pendingByTable = new Map<string, PendingTableState>();

  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: IEventBus | null = null
  ) {}

  async onTaskEnqueued(
    params: {
      taskId: string;
      baseId: string;
      targets: ReadonlyArray<FieldComputeTarget>;
      metrics: ComputedActivityTaskMetrics;
      now?: Date;
      trx?: DbLike;
    },
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>> {
    if (params.targets.length === 0) return ok(null);
    const baseIdResult = BaseId.create(params.baseId);
    if (baseIdResult.isErr()) return err(baseIdResult.error);
    const baseId = baseIdResult.value;
    if (this.asyncProjectionEnabled) {
      // Ledger only: per-task ref rows have no shared-row contention, so neither
      // the advisory lock nor the in-process enqueue gate is needed here.
      const pendingEvents: PendingActivityEvent[] = [];
      const result = await this.run(
        context,
        async (trx) => {
          const now = params.now ?? new Date();
          const newTargets = await this.insertTaskRefs(
            trx,
            params.taskId,
            params.targets,
            baseId,
            now
          );
          for (const [, targets] of groupTargetsByTable(newTargets)) {
            pendingEvents.push({
              kind: 'enqueued',
              baseId,
              targets,
              metrics: params.metrics,
              at: now,
            });
          }
          return ok(null);
        },
        'activity_on_task_enqueued',
        params.trx
      );
      if (result.isOk()) this.queuePendingEvents(context, pendingEvents);
      return result;
    }
    const projectOnce = () =>
      this.run(
        context,
        async (trx) => {
          const now = params.now ?? new Date();
          const locked = await this.lockTouchedTables(
            trx,
            params.targets,
            'activity_on_task_enqueued'
          );
          if (!locked) return ok(null);
          const targetsByFieldId = new Map(
            params.targets.map((target) => [target.fieldId.toString(), target])
          );
          const insertedFieldIds = new Set<string>();
          const refRows = [...targetsByFieldId.values()].map((target) => ({
            task_id: params.taskId,
            field_id: target.fieldId.toString(),
            table_id: target.tableId.toString(),
            base_id: baseId.toString(),
            was_processing: false,
            created_at: now,
          }));
          for (let offset = 0; offset < refRows.length; offset += ACTIVITY_WRITE_BATCH_SIZE) {
            const inserted = await trx
              .insertInto(TASK_FIELD_REF_TABLE)
              .values(refRows.slice(offset, offset + ACTIVITY_WRITE_BATCH_SIZE))
              .onConflict((oc) => oc.columns(['task_id', 'field_id']).doNothing())
              .returning('field_id')
              .execute();
            for (const row of inserted) insertedFieldIds.add(String(row.field_id));
          }
          const newTargets = [...insertedFieldIds]
            .map((fieldId) => targetsByFieldId.get(fieldId))
            .filter((target): target is FieldComputeTarget => target != null);
          if (newTargets.length === 0) return ok(null);
          await this.ensureActivityRows(trx, newTargets, baseId, now);

          const activityResult = await this.loadActivity(trx, newTargets);
          if (activityResult.isErr()) return err(activityResult.error);
          const activity = activityResult.value;
          // Metrics only — absolute counters come from persisted refs (T6276).
          activity.noteEnqueueMetrics({
            baseId,
            targets: newTargets,
            estimatedComplexity: params.metrics.estimatedComplexity,
            estimatedDirtyRecords: params.metrics.estimatedDirtyRecords,
            hasAllTargetRecords: params.metrics.hasAllTargetRecords,
            batchProgress: params.metrics.batchProgress,
            now,
          });
          const synced = await this.syncActivityFromTaskRefs(trx, activity, newTargets, now);
          if (synced.isErr()) return err(synced.error);
          return ok(await this.persistSnapshot(trx, activity));
        },
        'activity_on_task_enqueued',
        params.trx
      );
    return this.serializeEnqueueProjection(params.targets, projectOnce, () => ok(null));
  }

  async onTasksClaimed(
    params: {
      tasks: ReadonlyArray<{
        taskId: string;
        baseId: string;
      }>;
      now?: Date;
      trx?: DbLike;
    },
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>> {
    if (params.tasks.length === 0) return ok(null);
    const pendingEvents: PendingActivityEvent[] = [];
    const result = await this.run(
      context,
      async (trx) => {
        const now = params.now ?? new Date();
        const taskIds: string[] = [];
        const targetsByField = new Map<string, StoredActivityTarget>();

        const requestedTaskIds = [...new Set(params.tasks.map((task) => task.taskId))];
        const pendingRefs = await trx
          .selectFrom(TASK_FIELD_REF_TABLE)
          .selectAll()
          .where('task_id', 'in', requestedTaskIds)
          .where('was_processing', '=', false)
          .execute();
        if (pendingRefs.length === 0) return ok(null);

        pushAll(taskIds, new Set(pendingRefs.map((ref) => String(ref.task_id))));
        const parsedTargets = storedActivityTargets(pendingRefs as Array<Record<string, unknown>>);
        if (parsedTargets.isErr()) return err(parsedTargets.error);
        for (const target of parsedTargets.value) {
          targetsByField.set(target.fieldId.toString(), target);
        }

        const targets = [...targetsByField.values()];
        if (targets.length === 0) return ok(null);

        if (this.asyncProjectionEnabled) {
          await trx
            .updateTable(TASK_FIELD_REF_TABLE)
            .set({ was_processing: true })
            .where('task_id', 'in', taskIds)
            .where('was_processing', '=', false)
            .execute();
          for (const [, tableTargets] of groupTargetsByTable(targets)) {
            pendingEvents.push({ kind: 'refs_changed', targets: tableTargets, at: now });
          }
          return ok(null);
        }

        const locked = await this.lockTouchedTables(trx, targets, 'activity_on_tasks_claimed');
        if (!locked) return ok(null);

        await trx
          .updateTable(TASK_FIELD_REF_TABLE)
          .set({ was_processing: true })
          .where('task_id', 'in', taskIds)
          .where('was_processing', '=', false)
          .execute();

        const activityResult = await this.loadActivity(trx, targets);
        if (activityResult.isErr()) return err(activityResult.error);
        const activity = activityResult.value;
        const refCounts = await this.loadRefCountsByField(
          trx,
          targets.map((target) => target.fieldId.toString())
        );
        const syncedTargets = targets.map((target) => {
          const counts = refCounts.get(target.fieldId.toString()) ?? {
            activeTaskCount: 0,
            processingTaskCount: 0,
          };
          return {
            ...target,
            activeTaskCount: counts.activeTaskCount,
            processingTaskCount: counts.processingTaskCount,
          };
        });
        activity.syncFromTaskRefs({ targets: syncedTargets, now });
        return ok(await this.persistSnapshot(trx, activity));
      },
      'activity_on_tasks_claimed',
      params.trx
    );
    if (result.isOk()) this.queuePendingEvents(context, pendingEvents);
    return result;
  }

  async onTaskDone(
    params: {
      taskId: string;
      baseId?: string;
      durationMs?: number;
      fieldErrors?: ReadonlyArray<ComputedActivityFieldError>;
      now?: Date;
      trx?: DbLike;
    },
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>> {
    return this.releaseTask(
      {
        taskId: params.taskId,
        baseId: params.baseId,
        durationMs: params.durationMs,
        now: params.now,
        error: null,
        fieldErrors: params.fieldErrors,
        trx: params.trx,
      },
      context,
      'activity_on_task_done'
    );
  }

  async onTaskFailed(
    params: {
      taskId: string;
      baseId?: string;
      error: { code?: string; message: string };
      terminal: boolean;
      durationMs?: number;
      now?: Date;
      trx?: DbLike;
    },
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>> {
    if (params.terminal) {
      return this.releaseTask(
        {
          taskId: params.taskId,
          baseId: params.baseId,
          durationMs: params.durationMs,
          now: params.now,
          error: params.error,
          trx: params.trx,
        },
        context,
        'activity_on_task_failed_terminal'
      );
    }

    // Retry path: clear was_processing and derive processing state from task refs.
    const pendingEvents: PendingActivityEvent[] = [];
    const result = await this.run(
      context,
      async (trx) => {
        const now = params.now ?? new Date();
        const refs = await trx
          .selectFrom(TASK_FIELD_REF_TABLE)
          .selectAll()
          .where('task_id', '=', params.taskId)
          .execute();
        if (refs.length === 0) return ok(null);

        const targetsResult = storedActivityTargets(
          refs as Array<Record<string, unknown>>,
          params.baseId
        );
        if (targetsResult.isErr()) return err(targetsResult.error);
        const targets = targetsResult.value;

        if (this.asyncProjectionEnabled) {
          await trx
            .updateTable(TASK_FIELD_REF_TABLE)
            .set({ was_processing: false })
            .where('task_id', '=', params.taskId)
            .execute();
          for (const [, tableTargets] of groupTargetsByTable(targets)) {
            pendingEvents.push({
              kind: 'retry',
              targets: tableTargets,
              error: params.error,
              at: now,
            });
          }
          return ok(null);
        }

        const locked = await this.lockTouchedTables(trx, targets, 'activity_on_task_failed_retry');
        if (!locked) return ok(null);

        await trx
          .updateTable(TASK_FIELD_REF_TABLE)
          .set({ was_processing: false })
          .where('task_id', '=', params.taskId)
          .execute();

        const activityResult = await this.loadActivity(trx, targets);
        if (activityResult.isErr()) return err(activityResult.error);
        const activity = activityResult.value;
        // Retry diagnostics are not a completed batch step. Ref sync below clears
        // processing state and commits both metadata and counters in one generation.
        activity.noteRetryScheduled({ targets, error: params.error, now });
        const synced = await this.syncActivityFromTaskRefs(trx, activity, targets, now);
        if (synced.isErr()) return err(synced.error);
        return ok(await this.persistSnapshot(trx, activity));
      },
      'activity_on_task_failed_retry',
      params.trx
    );
    if (result.isOk()) this.queuePendingEvents(context, pendingEvents);
    return result;
  }

  /**
   * Combined tail for one outbox-worker stage transaction. Settles up to three
   * lifecycle events on one lock round + one load + one persist instead of the
   * three independent rounds onTaskEnqueued / onTasksClaimed / onTaskDone would
   * otherwise each pay:
   *  - `done`: the task completing this transaction (ref delete + noteTaskFinished).
   *  - `enqueued` (optional): the continuation task created in the same transaction
   *    (ref insert + noteEnqueueMetrics), mirroring onTaskEnqueued.
   *  - `claimed` (optional): tasks relay-claimed in the same transaction — normally
   *    just the `enqueued` task's own id (was_processing flip), mirroring
   *    onTasksClaimed. A claimed id equal to `enqueued.taskId` reuses the enqueue
   *    sync below (it already reflects the post-claim ref state, since every write
   *    in this method runs before any ref-count read); only claimed ids for OTHER
   *    tasks get their own sync pass.
   */
  async projectStageSettlement(
    params: {
      done: {
        taskId: string;
        baseId?: string;
        durationMs?: number;
        error?: { code?: string; message: string } | null;
        fieldErrors?: ReadonlyArray<ComputedActivityFieldError>;
      };
      enqueued?: {
        taskId: string;
        baseId: string;
        targets: ReadonlyArray<FieldComputeTarget>;
        metrics: ComputedActivityTaskMetrics;
      };
      claimed?: ReadonlyArray<{ taskId: string; baseId: string }>;
      now?: Date;
      trx?: DbLike;
    },
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>> {
    const pendingEvents: PendingActivityEvent[] = [];
    const result = await this.run(
      context,
      async (trx) => {
        const now = params.now ?? new Date();

        // `done` targets come from its still-live refs, read before the delete below.
        const doneRefs = await trx
          .selectFrom(TASK_FIELD_REF_TABLE)
          .selectAll()
          .where('task_id', '=', params.done.taskId)
          .execute();
        const doneTargetsResult = storedActivityTargets(
          doneRefs as Array<Record<string, unknown>>,
          params.done.baseId
        );
        if (doneTargetsResult.isErr()) return err(doneTargetsResult.error);
        const doneTargets = doneTargetsResult.value;

        // Claimed ids other than the enqueued task's own id must already have
        // persisted refs (they were enqueued by an earlier transaction); resolve
        // their targets up front, same as onTasksClaimed does today. A claimed id
        // matching `enqueued.taskId` has no persisted ref yet at this point — its
        // refs are inserted below in this same call.
        const claimedTaskIds = [...new Set((params.claimed ?? []).map((task) => task.taskId))];
        const externalClaimedTaskIds = claimedTaskIds.filter(
          (taskId) => taskId !== params.enqueued?.taskId
        );
        const externalClaimedRefs =
          externalClaimedTaskIds.length > 0
            ? await trx
                .selectFrom(TASK_FIELD_REF_TABLE)
                .selectAll()
                .where('task_id', 'in', externalClaimedTaskIds)
                .where('was_processing', '=', false)
                .execute()
            : [];
        const externalClaimedTargetsResult = storedActivityTargets(
          externalClaimedRefs as Array<Record<string, unknown>>
        );
        if (externalClaimedTargetsResult.isErr()) return err(externalClaimedTargetsResult.error);
        const externalClaimedTargets = externalClaimedTargetsResult.value;

        if (this.asyncProjectionEnabled) {
          const events = pendingEvents;
          if (params.enqueued && params.enqueued.targets.length > 0) {
            const baseIdResult = BaseId.create(params.enqueued.baseId);
            if (baseIdResult.isErr()) return err(baseIdResult.error);
            const enqueuedBase = baseIdResult.value;
            const newTargets = await this.insertTaskRefs(
              trx,
              params.enqueued.taskId,
              params.enqueued.targets,
              enqueuedBase,
              now
            );
            for (const [, tableTargets] of groupTargetsByTable(newTargets)) {
              events.push({
                kind: 'enqueued',
                baseId: enqueuedBase,
                targets: tableTargets,
                metrics: params.enqueued.metrics,
                at: now,
              });
            }
          }
          if (claimedTaskIds.length > 0) {
            await trx
              .updateTable(TASK_FIELD_REF_TABLE)
              .set({ was_processing: true })
              .where('task_id', 'in', claimedTaskIds)
              .where('was_processing', '=', false)
              .execute();
            for (const [, tableTargets] of groupTargetsByTable(externalClaimedTargets)) {
              events.push({ kind: 'refs_changed', targets: tableTargets, at: now });
            }
          }
          if (doneRefs.length > 0) {
            await trx
              .deleteFrom(TASK_FIELD_REF_TABLE)
              .where('task_id', '=', params.done.taskId)
              .execute();
            const doneBaseId = doneTargets[0]!.baseId;
            for (const [, tableTargets] of groupTargetsByTable(doneTargets)) {
              events.push({
                kind: 'finished',
                taskId: params.done.taskId,
                baseId: doneBaseId,
                targets: tableTargets,
                durationMs: params.done.durationMs,
                error: params.done.error ?? null,
                fieldErrors: params.done.fieldErrors,
                at: now,
              });
            }
          }
          return ok(null);
        }

        // Lock scope covers every table a write below can touch (insert, update,
        // or delete), matching each contributing method's own lock scope.
        const lockTargets: Array<Pick<FieldComputeTarget, 'tableId'>> = [
          ...doneTargets,
          ...(params.enqueued?.targets ?? []),
          ...externalClaimedTargets,
        ];
        const locked = await this.lockTouchedTables(
          trx,
          lockTargets,
          'activity_project_stage_settlement'
        );
        if (!locked) return ok(null);

        let enqueuedBaseId: BaseId | undefined;
        let newEnqueuedTargets: FieldComputeTarget[] = [];
        if (params.enqueued && params.enqueued.targets.length > 0) {
          const baseIdResult = BaseId.create(params.enqueued.baseId);
          if (baseIdResult.isErr()) return err(baseIdResult.error);
          enqueuedBaseId = baseIdResult.value;
          const targetsByFieldId = new Map(
            params.enqueued.targets.map((target) => [target.fieldId.toString(), target])
          );
          const insertedFieldIds = new Set<string>();
          const refRows = [...targetsByFieldId.values()].map((target) => ({
            task_id: params.enqueued!.taskId,
            field_id: target.fieldId.toString(),
            table_id: target.tableId.toString(),
            base_id: enqueuedBaseId!.toString(),
            was_processing: false,
            created_at: now,
          }));
          for (let offset = 0; offset < refRows.length; offset += ACTIVITY_WRITE_BATCH_SIZE) {
            const inserted = await trx
              .insertInto(TASK_FIELD_REF_TABLE)
              .values(refRows.slice(offset, offset + ACTIVITY_WRITE_BATCH_SIZE))
              .onConflict((oc) => oc.columns(['task_id', 'field_id']).doNothing())
              .returning('field_id')
              .execute();
            for (const row of inserted) insertedFieldIds.add(String(row.field_id));
          }
          newEnqueuedTargets = [...insertedFieldIds]
            .map((fieldId) => targetsByFieldId.get(fieldId))
            .filter((target): target is FieldComputeTarget => target != null);
          if (newEnqueuedTargets.length > 0) {
            await this.ensureActivityRows(trx, newEnqueuedTargets, enqueuedBaseId, now);
          }
        }

        if (claimedTaskIds.length > 0) {
          await trx
            .updateTable(TASK_FIELD_REF_TABLE)
            .set({ was_processing: true })
            .where('task_id', 'in', claimedTaskIds)
            .where('was_processing', '=', false)
            .execute();
        }

        if (doneRefs.length > 0) {
          await trx
            .deleteFrom(TASK_FIELD_REF_TABLE)
            .where('task_id', '=', params.done.taskId)
            .execute();
        }

        const loadTargets: FieldComputeTarget[] = [
          ...doneTargets,
          ...newEnqueuedTargets,
          ...externalClaimedTargets,
        ];
        if (loadTargets.length === 0) return ok(null);

        const activityResult = await this.loadActivity(trx, loadTargets);
        if (activityResult.isErr()) return err(activityResult.error);
        const activity = activityResult.value;

        if (params.enqueued && newEnqueuedTargets.length > 0 && enqueuedBaseId) {
          activity.noteEnqueueMetrics({
            baseId: enqueuedBaseId,
            targets: newEnqueuedTargets,
            estimatedComplexity: params.enqueued.metrics.estimatedComplexity,
            estimatedDirtyRecords: params.enqueued.metrics.estimatedDirtyRecords,
            hasAllTargetRecords: params.enqueued.metrics.hasAllTargetRecords,
            batchProgress: params.enqueued.metrics.batchProgress,
            now,
          });
          const synced = await this.syncActivityFromTaskRefs(
            trx,
            activity,
            newEnqueuedTargets,
            now
          );
          if (synced.isErr()) return err(synced.error);
        }

        if (externalClaimedTargets.length > 0) {
          const synced = await this.syncActivityFromTaskRefs(
            trx,
            activity,
            externalClaimedTargets,
            now
          );
          if (synced.isErr()) return err(synced.error);
        }

        if (doneTargets.length > 0) {
          const doneBaseId = doneTargets[0]!.baseId;
          activity.noteTaskFinished({
            baseId: doneBaseId,
            taskId: params.done.taskId,
            targets: doneTargets,
            durationMs: params.done.durationMs,
            error: params.done.error ?? null,
            now,
          });
          if (params.done.fieldErrors?.length) {
            activity.notePersistentFieldErrors({
              errors: params.done.fieldErrors,
              now,
            });
          }
          const synced = await this.syncActivityFromTaskRefs(trx, activity, doneTargets, now);
          if (synced.isErr()) return err(synced.error);
        }

        this.logger.debug('computed:activity:stage_settlement_projected', {
          doneTaskId: params.done.taskId,
          doneFieldCount: doneTargets.length,
          enqueuedTaskId: params.enqueued?.taskId,
          enqueuedFieldCount: params.enqueued?.targets.length ?? 0,
          newEnqueuedFieldCount: newEnqueuedTargets.length,
          claimedTaskIds,
        });

        return ok(await this.persistSnapshot(trx, activity));
      },
      'activity_project_stage_settlement',
      params.trx
    );
    if (result.isOk()) this.queuePendingEvents(context, pendingEvents);
    return result;
  }

  async reconcileTable(
    params: {
      tableId: string;
      baseId?: string;
      now?: Date;
      trx?: DbLike;
      lockTimeoutMs?: number;
    },
    context?: IExecutionContext
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>> {
    const tableIdResult = TableId.create(params.tableId);
    if (tableIdResult.isErr()) return err(tableIdResult.error);
    const tableId = tableIdResult.value;

    return this.run(
      context,
      async (trx) => {
        const now = params.now ?? new Date();
        const locked = await this.lockTouchedTables(
          trx,
          [{ tableId }],
          'activity_reconcile_table',
          params.lockTimeoutMs
        );
        if (!locked) return ok(null);

        // Drop activity refs whose outbox task no longer exists. Those leave the UI
        // stuck in queued/running with no worker progress.
        await trx
          .deleteFrom(`${TASK_FIELD_REF_TABLE} as refs`)
          .where('refs.table_id', '=', tableId.toString())
          .where(({ exists, not, selectFrom }) =>
            not(
              exists(
                selectFrom('computed_update_outbox as outbox')
                  .select('outbox.id')
                  .whereRef('outbox.id', '=', 'refs.task_id')
              )
            )
          )
          .execute();

        // Load every field/table activity row so idle fields with dangling refs and
        // table-only calculating drift are both repaired.
        const fieldRows = await trx
          .selectFrom(FIELD_ACTIVITY_TABLE)
          .selectAll()
          .where('table_id', '=', tableId.toString())
          .forUpdate()
          .execute();

        const tableRow = await trx
          .selectFrom(TABLE_ACTIVITY_TABLE)
          .selectAll()
          .where('table_id', '=', tableId.toString())
          .forUpdate()
          .executeTakeFirst();

        // Live refs whose field has no activity row yet (async-projection events
        // lost before their first flush — pod restart, queue overflow). Without
        // folding these in, the running work would stay invisible forever: the
        // drift detector joins FROM the activity table and cannot see them.
        const activityFieldIds = new Set(fieldRows.map((row) => String(row.field_id)));
        const reliabilityStore = new PostgresComputedReliabilityStore(trx);
        const reliabilityVisible = isComputedReliabilityVisible(params.baseId);
        const failureTargets = reliabilityVisible
          ? await reliabilityStore.getFieldSummaries(tableId.toString())
          : [];
        const orphanRefRows = (
          await trx
            .selectFrom(TASK_FIELD_REF_TABLE)
            .select(['field_id', 'table_id', 'base_id'])
            .where('table_id', '=', tableId.toString())
            .execute()
        )
          .concat(
            failureTargets.map((item) => ({
              field_id: item.fieldId,
              table_id: tableId.toString(),
              base_id: item.baseId,
            }))
          )
          .filter((row) => !activityFieldIds.has(String(row.field_id)));

        if (fieldRows.length === 0 && !tableRow && orphanRefRows.length === 0) return ok(null);

        const baseIdRaw =
          params.baseId ??
          (tableRow ? String(tableRow.base_id) : undefined) ??
          (fieldRows[0] ? String(fieldRows[0].base_id) : undefined) ??
          (orphanRefRows[0] ? String(orphanRefRows[0].base_id) : undefined);
        if (!baseIdRaw) {
          return err(
            domainError.validation({
              message: 'Missing baseId while reconciling computed activity',
              details: { tableId: tableId.toString() },
            })
          );
        }
        const baseIdResult = BaseId.create(baseIdRaw);
        if (baseIdResult.isErr()) return err(baseIdResult.error);
        const baseId = baseIdResult.value;

        let activity: ComputedActivity;
        let targets: Array<FieldComputeTarget & { baseId: BaseId }> = [];

        if (fieldRows.length > 0 || orphanRefRows.length > 0) {
          const targetsResult = storedActivityTargets(
            [...fieldRows, ...orphanRefRows] as Array<Record<string, unknown>>,
            baseId.toString()
          );
          if (targetsResult.isErr()) return err(targetsResult.error);
          targets = targetsResult.value;

          const activityResult = await this.loadActivity(trx, targets);
          if (activityResult.isErr()) return err(activityResult.error);
          activity = activityResult.value;
        } else {
          // Table-only drift: no field activity rows, but table still calculating.
          const tableOnly = ComputedActivity.fromSnapshot({
            fields: [],
            tables: [tableActivityRowToDto(tableRow as Record<string, unknown>)],
          });
          if (tableOnly.isErr()) return err(tableOnly.error);
          activity = tableOnly.value;
        }

        if (targets.length > 0) {
          const synced = await this.syncActivityFromTaskRefs(
            trx,
            activity,
            targets,
            now,
            reliabilityVisible ? new Map([[tableId.toString(), failureTargets]]) : undefined
          );
          if (synced.isErr()) return err(synced.error);
        } else {
          // Force table aggregate back to idle from empty field set.
          activity.ensureTable({ tableId, baseId, now }).recomputeFromFields([], now);
        }

        const changed = activity.changedSnapshot();
        if (changed.fields.length === 0 && changed.tables.length === 0) return ok(null);

        this.logger.warn('computed:activity:reconciled_table', {
          tableId: tableId.toString(),
          fieldCount: targets.length,
        });
        return ok(await this.persistSnapshot(trx, activity));
      },
      'activity_reconcile_table',
      params.trx
    );
  }

  private async releaseTask(
    params: {
      taskId: string;
      baseId?: string;
      durationMs?: number;
      now?: Date;
      error: { code?: string; message: string } | null;
      fieldErrors?: ReadonlyArray<ComputedActivityFieldError>;
      trx?: DbLike;
    },
    context: IExecutionContext | undefined,
    operation: string
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>> {
    const pendingEvents: PendingActivityEvent[] = [];
    const result = await this.run(
      context,
      async (trx) => {
        const now = params.now ?? new Date();
        const refs = await trx
          .selectFrom(TASK_FIELD_REF_TABLE)
          .selectAll()
          .where('task_id', '=', params.taskId)
          .execute();
        if (refs.length === 0) return ok(null);

        const targetsResult = storedActivityTargets(
          refs as Array<Record<string, unknown>>,
          params.baseId
        );
        if (targetsResult.isErr()) return err(targetsResult.error);
        const targets = targetsResult.value;
        const baseId = targets[0]!.baseId;

        if (this.asyncProjectionEnabled) {
          await trx.deleteFrom(TASK_FIELD_REF_TABLE).where('task_id', '=', params.taskId).execute();
          for (const [, tableTargets] of groupTargetsByTable(targets)) {
            pendingEvents.push({
              kind: 'finished',
              taskId: params.taskId,
              baseId,
              targets: tableTargets,
              durationMs: params.durationMs,
              error: params.error,
              fieldErrors: params.fieldErrors,
              at: now,
            });
          }
          return ok(null);
        }

        const locked = await this.lockTouchedTables(trx, targets, operation);
        if (!locked) return ok(null);
        await trx.deleteFrom(TASK_FIELD_REF_TABLE).where('task_id', '=', params.taskId).execute();

        const activityResult = await this.loadActivity(trx, targets);
        if (activityResult.isErr()) return err(activityResult.error);
        const activity = activityResult.value;
        // A task can fan out to many fields and tables. Keep one task identity on
        // every projected completion so downstream load accounting can deduplicate it.
        activity.noteTaskFinished({
          baseId,
          taskId: params.taskId,
          targets,
          durationMs: params.durationMs,
          error: params.error,
          now,
        });
        if (params.fieldErrors?.length) {
          activity.notePersistentFieldErrors({
            errors: params.fieldErrors,
            now,
          });
        }
        const synced = await this.syncActivityFromTaskRefs(trx, activity, targets, now);
        if (synced.isErr()) return err(synced.error);
        return ok(await this.persistSnapshot(trx, activity));
      },
      operation,
      params.trx
    );
    if (result.isOk()) this.queuePendingEvents(context, pendingEvents);
    return result;
  }

  private async insertTaskRefs(
    trx: DbLike,
    taskId: string,
    targets: ReadonlyArray<FieldComputeTarget>,
    baseId: BaseId,
    now: Date
  ): Promise<FieldComputeTarget[]> {
    const targetsByFieldId = new Map(targets.map((target) => [target.fieldId.toString(), target]));
    const insertedFieldIds = new Set<string>();
    const refRows = [...targetsByFieldId.values()].map((target) => ({
      task_id: taskId,
      field_id: target.fieldId.toString(),
      table_id: target.tableId.toString(),
      base_id: baseId.toString(),
      was_processing: false,
      created_at: now,
    }));
    for (let offset = 0; offset < refRows.length; offset += ACTIVITY_WRITE_BATCH_SIZE) {
      const inserted = await trx
        .insertInto(TASK_FIELD_REF_TABLE)
        .values(refRows.slice(offset, offset + ACTIVITY_WRITE_BATCH_SIZE))
        .onConflict((oc) => oc.columns(['task_id', 'field_id']).doNothing())
        .returning('field_id')
        .execute();
      for (const row of inserted) insertedFieldIds.add(String(row.field_id));
    }
    return [...insertedFieldIds]
      .map((fieldId) => targetsByFieldId.get(fieldId))
      .filter((target): target is FieldComputeTarget => target != null);
  }

  /** Test/ops hook: override the env-derived async projection settings. */
  configureAsyncProjection(options: { enabled?: boolean; debounceMs?: number }): void {
    if (options.enabled !== undefined) this.asyncProjectionEnabled = options.enabled;
    if (options.debounceMs !== undefined) this.asyncFlushDebounceMs = options.debounceMs;
  }

  private queuePendingEvents(
    context: IExecutionContext | undefined,
    events: ReadonlyArray<PendingActivityEvent>
  ): void {
    if (events.length === 0 || this.asyncFlusherDisposed) return;
    const enqueue = () => {
      if (this.asyncFlusherDisposed) return;
      const touchedTableIds = new Set<string>();
      for (const event of events) {
        const tableId = event.targets[0]!.tableId.toString();
        touchedTableIds.add(tableId);
        let state = this.pendingByTable.get(tableId);
        if (!state) {
          state = {
            events: [],
            timer: null,
            flushing: false,
            retryDelayMs: 0,
            consecutiveFailures: 0,
            notReadyRetries: 0,
            droppedEvents: 0,
          };
          this.pendingByTable.set(tableId, state);
        }
        if (state.events.length >= ACTIVITY_ASYNC_PENDING_EVENTS_MAX) {
          // Counters heal from refs regardless; only event-borne diagnostics are lost.
          state.events.shift();
          state.droppedEvents += 1;
          if (state.droppedEvents === 1 || state.droppedEvents % 100 === 0) {
            this.logger.warn('computed:activity:async_events_dropped', {
              tableId,
              droppedEvents: state.droppedEvents,
            });
          }
        }
        state.events.push(event);
      }
      for (const tableId of touchedTableIds) {
        this.scheduleFlush(tableId, this.asyncFlushDebounceMs);
      }
    };
    // Queue only once the caller's transaction has committed: the flusher must
    // see the refs these events describe, and a rolled-back transaction must
    // not leak its metadata into the projection. Gate on getPostgresTransaction
    // (which checks the transaction is still pending) — a context whose
    // transaction already rolled back must fall through to the immediate path,
    // because registerAfterCommit would silently drop the handler while still
    // returning true. Without any usable hook (bare trx handle) we queue
    // immediately; the finished-event readiness check in applyPendingEvents
    // covers the resulting pre-commit window.
    if (
      getPostgresTransaction(context) &&
      context &&
      registerAfterCommit(context, async () => enqueue())
    ) {
      return;
    }
    enqueue();
  }

  /**
   * Stops the async flusher: clears every pending timer and drops queued
   * metadata. Call when the owning container is being destroyed — otherwise a
   * timer firing after db.destroy() would fail, requeue, and retry against the
   * dead pool forever. Dropped metadata is diagnostics only; counters re-derive
   * from refs wherever this container's tables are next projected.
   */
  disposeAsyncFlusher(): void {
    this.asyncFlusherDisposed = true;
    for (const state of this.pendingByTable.values()) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      state.events.length = 0;
    }
    this.pendingByTable.clear();
  }

  private scheduleFlush(tableId: string, delayMs: number): void {
    if (this.asyncFlusherDisposed) return;
    const state = this.pendingByTable.get(tableId);
    if (!state || state.timer) return;
    const timer = setTimeout(() => {
      state.timer = null;
      void this.flushTable(tableId);
    }, delayMs);
    timer.unref?.();
    state.timer = timer;
  }

  private async flushTable(tableId: string): Promise<void> {
    const state = this.pendingByTable.get(tableId);
    if (!state || state.flushing) return;
    if (state.events.length === 0) {
      if (!state.timer) this.pendingByTable.delete(tableId);
      return;
    }
    state.flushing = true;
    const events = state.events.splice(0);
    try {
      const force = state.notReadyRetries >= ACTIVITY_ASYNC_FLUSH_MAX_NOT_READY_RETRIES;
      const result = await this.applyPendingEvents(tableId, events, force);
      if (result === 'not_ready') {
        state.events.unshift(...events);
        state.notReadyRetries += 1;
        this.scheduleFlush(tableId, ACTIVITY_ASYNC_FLUSH_NOT_READY_DELAY_MS);
        return;
      }
      if (result === false) {
        // Lock busy: another flusher/reconciler owns the table right now.
        state.events.unshift(...events);
        state.retryDelayMs = Math.min(
          state.retryDelayMs > 0
            ? state.retryDelayMs * 2
            : ACTIVITY_ASYNC_FLUSH_RETRY_INITIAL_DELAY_MS,
          ACTIVITY_ASYNC_FLUSH_RETRY_MAX_DELAY_MS
        );
        this.scheduleFlush(tableId, state.retryDelayMs);
        return;
      }
      state.retryDelayMs = 0;
      state.consecutiveFailures = 0;
      state.notReadyRetries = 0;
      if (result) await this.publishActivityChanged(result, undefined);
      if (state.events.length > 0) this.scheduleFlush(tableId, this.asyncFlushDebounceMs);
      else if (!state.timer) this.pendingByTable.delete(tableId);
    } catch (error) {
      state.consecutiveFailures += 1;
      this.logger.warn('computed:activity:async_flush_failed', {
        tableId,
        eventCount: events.length,
        consecutiveFailures: state.consecutiveFailures,
        error: error instanceof Error ? error.message : String(error),
      });
      if (state.consecutiveFailures >= ACTIVITY_ASYNC_FLUSH_MAX_CONSECUTIVE_FAILURES) {
        this.logger.warn('computed:activity:async_flush_gave_up', {
          tableId,
          droppedEventCount: events.length,
        });
        this.pendingByTable.delete(tableId);
        return;
      }
      state.events.unshift(...events);
      state.retryDelayMs = Math.min(
        state.retryDelayMs > 0
          ? state.retryDelayMs * 2
          : ACTIVITY_ASYNC_FLUSH_RETRY_INITIAL_DELAY_MS,
        ACTIVITY_ASYNC_FLUSH_RETRY_MAX_DELAY_MS
      );
      this.scheduleFlush(tableId, state.retryDelayMs);
    } finally {
      state.flushing = false;
    }
  }

  /**
   * Applies one table's queued events in a fresh transaction as the single
   * writer of the activity tables. Returns 'not_ready' when a finished event's
   * ledger delete is not yet visible (caller requeues briefly), false when the
   * advisory lock is busy (caller requeues with backoff), null when nothing
   * changed, else the projection. Missing activity rows are created by the
   * domain (ensureField) + persistSnapshot's upsert — no pre-insert needed.
   */
  private async applyPendingEvents(
    tableId: string,
    events: ReadonlyArray<PendingActivityEvent>,
    force: boolean
  ): Promise<ComputedActivityProjectionResult | null | false | 'not_ready'> {
    const db = this.db as unknown as Kysely<DynamicDB>;
    const lockTarget = { tableId: events[0]!.targets[0]!.tableId };

    // Worker paths enqueue without an after-commit hook, so a 'finished' event
    // can arrive while its ledger transaction (which deletes the task's refs)
    // is still open on another connection. Flushing then would read the
    // pre-delete refs, persist the field as still running, and consume the
    // completion metadata with nothing left to correct it.
    if (!force) {
      const finishedTaskIds = [
        ...new Set(
          events
            .filter(
              (event): event is Extract<PendingActivityEvent, { kind: 'finished' }> =>
                event.kind === 'finished'
            )
            .map((event) => event.taskId)
        ),
      ];
      if (finishedTaskIds.length > 0) {
        const undeleted = await db
          .selectFrom(TASK_FIELD_REF_TABLE)
          .select('task_id')
          .where('task_id', 'in', finishedTaskIds)
          .limit(1)
          .executeTakeFirst();
        if (undeleted) return 'not_ready';
      }
    }

    return db
      .transaction()
      .execute(async (trx): Promise<ComputedActivityProjectionResult | null | false> => {
        const locked = await this.lockTouchedTables(
          trx as unknown as DbLike,
          [lockTarget],
          'activity_async_flush',
          ACTIVITY_ASYNC_FLUSH_LOCK_TIMEOUT_MS
        );
        if (!locked) return false;
        const dbTrx = trx as unknown as DbLike;

        const unionTargets = new Map<string, FieldComputeTarget & { baseId?: BaseId }>();
        for (const event of events) {
          for (const target of event.targets) {
            const key = target.fieldId.toString();
            const existing = unionTargets.get(key);
            const baseId =
              'baseId' in target
                ? (target as StoredActivityTarget).baseId
                : event.kind === 'enqueued'
                  ? event.baseId
                  : undefined;
            if (!existing || (!existing.baseId && baseId)) {
              unionTargets.set(key, { fieldId: target.fieldId, tableId: target.tableId, baseId });
            }
          }
        }
        const targets = [...unionTargets.values()];
        if (targets.length === 0) return null;

        const activityResult = await this.loadActivity(dbTrx, targets);
        if (activityResult.isErr()) {
          throw new ComputedActivityAbort(activityResult.error);
        }
        const activity = activityResult.value;

        for (const event of events) {
          switch (event.kind) {
            case 'enqueued':
              activity.noteEnqueueMetrics({
                baseId: event.baseId,
                targets: event.targets,
                estimatedComplexity: event.metrics.estimatedComplexity,
                estimatedDirtyRecords: event.metrics.estimatedDirtyRecords,
                hasAllTargetRecords: event.metrics.hasAllTargetRecords,
                batchProgress: event.metrics.batchProgress,
                now: event.at,
              });
              break;
            case 'finished':
              activity.noteTaskFinished({
                baseId: event.baseId,
                taskId: event.taskId,
                targets: event.targets,
                durationMs: event.durationMs,
                error: event.error,
                now: event.at,
              });
              if (event.fieldErrors?.length) {
                activity.notePersistentFieldErrors({ errors: event.fieldErrors, now: event.at });
              }
              break;
            case 'retry':
              activity.noteRetryScheduled({
                targets: event.targets,
                error: event.error,
                now: event.at,
              });
              break;
            case 'refs_changed':
              break;
          }
        }

        // The trailing sync is load-bearing beyond counters: note* calls above
        // only mark fields dirty, and changedSnapshot() persists a field only
        // when syncFromTaskRefs advanced its generation. Every event target is
        // in `targets`, so every touched field gets its sync here.
        const synced = await this.syncActivityFromTaskRefs(dbTrx, activity, targets, new Date());
        if (synced.isErr()) throw new ComputedActivityAbort(synced.error);
        return this.persistSnapshot(dbTrx, activity);
      });
    // ComputedActivityAbort propagates to flushTable's catch: the batch is
    // requeued and retried (bounded), not silently dropped.
  }

  /** Drains every pending table synchronously — for tests and shutdown. */
  async flushAllPendingActivity(): Promise<void> {
    for (let round = 0; round < 100; round += 1) {
      const tableIds = [...this.pendingByTable.keys()];
      if (tableIds.length === 0) return;
      for (const tableId of tableIds) {
        const state = this.pendingByTable.get(tableId);
        if (!state) continue;
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }
        if (state.flushing) {
          await sleep(10);
          continue;
        }
        await this.flushTable(tableId);
        const remaining = this.pendingByTable.get(tableId);
        if (remaining?.timer) {
          // flushTable rescheduled (lock busy); wait out the backoff here.
          clearTimeout(remaining.timer);
          remaining.timer = null;
          await sleep(10);
        }
      }
    }
    this.logger.warn('computed:activity:async_flush_drain_incomplete', {
      pendingTables: this.pendingByTable.size,
    });
  }

  private async ensureActivityRows(
    trx: DbLike,
    targets: ReadonlyArray<FieldComputeTarget>,
    baseId: BaseId,
    now: Date
  ): Promise<void> {
    const tableIds = [...new Set(targets.map((target) => target.tableId.toString()))].sort();
    const tableRows = tableIds.map((tableId) => ({
      table_id: tableId,
      base_id: baseId.toString(),
      status: 'idle',
      calculating_field_count: 0,
      queued_field_count: 0,
      estimated_complexity: 0,
      recent_completions: JSON.stringify([]),
      generation: 0,
      updated_at: now,
    }));
    for (let offset = 0; offset < tableRows.length; offset += ACTIVITY_WRITE_BATCH_SIZE) {
      await trx
        .insertInto(TABLE_ACTIVITY_TABLE)
        .values(tableRows.slice(offset, offset + ACTIVITY_WRITE_BATCH_SIZE))
        .onConflict((oc) => oc.column('table_id').doNothing())
        .execute();
    }

    const fieldRows = [
      ...new Map(targets.map((target) => [target.fieldId.toString(), target])).values(),
    ].map((target) => ({
      field_id: target.fieldId.toString(),
      table_id: target.tableId.toString(),
      base_id: baseId.toString(),
      status: 'idle',
      active_task_count: 0,
      processing_task_count: 0,
      generation: 0,
      estimated_complexity: 0,
      estimated_dirty_records: 0,
      has_all_target_records: false,
      updated_at: now,
    }));
    for (let offset = 0; offset < fieldRows.length; offset += ACTIVITY_WRITE_BATCH_SIZE) {
      await trx
        .insertInto(FIELD_ACTIVITY_TABLE)
        .values(fieldRows.slice(offset, offset + ACTIVITY_WRITE_BATCH_SIZE))
        .onConflict((oc) => oc.column('field_id').doNothing())
        .execute();
    }
  }

  // Rate-limited gate for the contention warn: one log per (operation, table)
  // per interval keeps the convoy signal while dropping repeat noise.
  private shouldLogLockContention(operation: string, tableId: string, waitedMs: number): boolean {
    if (waitedMs < this.lockContentionLogThresholdMs) return false;
    const rateLimitKey = `${operation}:${tableId}`;
    const nowMs = Date.now();
    const lastLoggedAt = this.lockContentionLogLastAt.get(rateLimitKey);
    if (lastLoggedAt !== undefined && nowMs - lastLoggedAt < this.lockContentionLogIntervalMs) {
      return false;
    }
    this.lockContentionLogLastAt.set(rateLimitKey, nowMs);
    return true;
  }

  // Returns false when the bounded wait expires; callers skip the projection in that case
  // instead of parking their (possibly caller-owned) transaction on the lock queue.
  private async lockTouchedTables(
    trx: DbLike,
    targets: ReadonlyArray<Pick<FieldComputeTarget, 'tableId'>>,
    operation: string,
    timeoutMs: number = ACTIVITY_ADVISORY_LOCK_TIMEOUT_MS
  ): Promise<boolean> {
    const tableIds = [...new Set(targets.map((target) => target.tableId.toString()))].sort();
    const deadline = Date.now() + timeoutMs;
    for (const tableId of tableIds) {
      let retryDelayMs = ACTIVITY_ADVISORY_LOCK_RETRY_INITIAL_DELAY_MS;
      const acquireStartedAt = Date.now();
      for (;;) {
        const result = await trx.executeQuery(
          buildTryAdvisoryLockQuery(trx, `v2:computed-activity:table:${tableId}`)
        );
        if (result.rows[0]?.locked) {
          // Sustained contention on a table's lock is the leading indicator of a
          // projection-vs-poll convoy (see the 2026-08-14 CN outage) — the
          // timeout warn below only fires once the budget is already gone.
          const waitedMs = Date.now() - acquireStartedAt;
          if (this.shouldLogLockContention(operation, tableId, waitedMs)) {
            this.logger.warn('computed:activity:lock_contended', {
              operation,
              tableId,
              waitedMs,
            });
          }
          break;
        }
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          this.logger.warn('computed:activity:lock_timeout_projection_skipped', {
            operation,
            tableId,
            timeoutMs,
          });
          return false;
        }
        await sleep(Math.min(retryDelayMs, remainingMs));
        retryDelayMs = Math.min(retryDelayMs * 2, ACTIVITY_ADVISORY_LOCK_RETRY_MAX_DELAY_MS);
      }
    }
    return true;
  }

  private async loadRefCountsByField(
    trx: DbLike,
    fieldIds: ReadonlyArray<string>
  ): Promise<Map<string, { activeTaskCount: number; processingTaskCount: number }>> {
    const counts = new Map<string, { activeTaskCount: number; processingTaskCount: number }>();
    for (const fieldId of fieldIds) {
      counts.set(fieldId, { activeTaskCount: 0, processingTaskCount: 0 });
    }
    if (fieldIds.length === 0) return counts;

    const rows = await trx
      .selectFrom(TASK_FIELD_REF_TABLE)
      .select([
        'field_id',
        sql<number>`count(*)::int`.as('active_task_count'),
        sql<number>`count(*) filter (where was_processing = true)::int`.as('processing_task_count'),
      ])
      .where('field_id', 'in', [...fieldIds])
      .groupBy('field_id')
      .execute();

    for (const row of rows) {
      counts.set(String(row.field_id), {
        activeTaskCount: toNumber(row.active_task_count),
        processingTaskCount: toNumber(row.processing_task_count),
      });
    }
    return counts;
  }

  private async countProcessingRefs(trx: DbLike, fieldId: FieldId): Promise<number> {
    const counts = await this.loadRefCountsByField(trx, [fieldId.toString()]);
    return counts.get(fieldId.toString())?.processingTaskCount ?? 0;
  }

  private async syncActivityFromTaskRefs(
    trx: DbLike,
    activity: ComputedActivity,
    targets: ReadonlyArray<FieldComputeTarget & { baseId?: BaseId }>,
    now: Date,
    loadedReliability?: ReadonlyMap<
      string,
      Awaited<ReturnType<PostgresComputedReliabilityStore['getFieldSummaries']>>
    >
  ): Promise<Result<void, DomainError>> {
    if (targets.length === 0) return ok(undefined);

    const uniqueTargets = new Map<string, FieldComputeTarget & { baseId?: BaseId }>();
    for (const target of targets) {
      uniqueTargets.set(target.fieldId.toString(), target);
    }

    const refCounts = await this.loadRefCountsByField(trx, [...uniqueTargets.keys()]);
    const resolved: Array<
      FieldComputeTarget & {
        baseId: BaseId;
        activeTaskCount: number;
        processingTaskCount: number;
      }
    > = [];

    for (const target of uniqueTargets.values()) {
      const field = activity.getField(target.fieldId);
      const baseId = target.baseId ?? field?.baseId();
      if (!baseId) {
        return err(
          domainError.validation({
            message: 'Missing baseId while syncing computed activity refs',
            details: { fieldId: target.fieldId.toString() },
          })
        );
      }
      const counts = refCounts.get(target.fieldId.toString()) ?? {
        activeTaskCount: 0,
        processingTaskCount: 0,
      };
      resolved.push({
        fieldId: target.fieldId,
        tableId: target.tableId,
        baseId,
        activeTaskCount: counts.activeTaskCount,
        processingTaskCount: counts.processingTaskCount,
      });
    }

    activity.syncFromTaskRefs({ targets: resolved, now });
    const store = new PostgresComputedReliabilityStore(trx);
    if (
      resolved.some((target) => isComputedReliabilityVisible(target.baseId.toString())) &&
      (loadedReliability || (await store.isReady()))
    ) {
      for (const tableId of new Set(resolved.map((target) => target.tableId.toString()))) {
        const summaries = new Map(
          (loadedReliability?.get(tableId) ?? (await store.getFieldSummaries(tableId, true))).map(
            (item) => [item.fieldId, item.reliability]
          )
        );
        for (const target of resolved.filter((item) => item.tableId.toString() === tableId)) {
          activity
            .getField(target.fieldId)
            ?.syncReliability(
              summaries.get(target.fieldId.toString()) ?? emptyComputeReliability(),
              now
            );
        }
      }
    }
    return ok(undefined);
  }

  private async loadActivity(
    trx: DbLike,
    targets: ReadonlyArray<FieldComputeTarget>
  ): Promise<Result<ComputedActivity, DomainError>> {
    const fieldIds = [...new Set(targets.map((target) => target.fieldId.toString()))];
    const tableIds = [...new Set(targets.map((target) => target.tableId.toString()))];

    const fieldRows =
      tableIds.length > 0
        ? await trx
            .selectFrom(FIELD_ACTIVITY_TABLE)
            .selectAll()
            .where('table_id', 'in', tableIds)
            .forUpdate()
            .execute()
        : fieldIds.length > 0
          ? await trx
              .selectFrom(FIELD_ACTIVITY_TABLE)
              .selectAll()
              .where('field_id', 'in', fieldIds)
              .forUpdate()
              .execute()
          : [];

    const tableRows =
      tableIds.length > 0
        ? await trx
            .selectFrom(TABLE_ACTIVITY_TABLE)
            .selectAll()
            .where('table_id', 'in', tableIds)
            .forUpdate()
            .execute()
        : [];

    return ComputedActivity.fromSnapshot({
      fields: fieldRows.map((row) => fieldActivityRowToDto(row as Record<string, unknown>)),
      tables: tableRows.map((row) => tableActivityRowToDto(row as Record<string, unknown>)),
    });
  }

  private async persistSnapshot(
    trx: DbLike,
    activity: ComputedActivity
  ): Promise<ComputedActivityProjectionResult> {
    const changed = activity.changedSnapshot();
    const fieldRows = changed.fields.map((field) => ({
      field_id: field.fieldId,
      table_id: field.tableId,
      base_id: field.baseId,
      status: field.status,
      active_task_count: field.activeTaskCount,
      processing_task_count: field.processingTaskCount,
      generation: field.generation,
      estimated_complexity: field.estimatedComplexity,
      estimated_dirty_records: field.estimatedDirtyRecords,
      has_all_target_records: field.hasAllTargetRecords,
      queued_at: field.queuedAt ? new Date(field.queuedAt) : null,
      started_at: field.startedAt ? new Date(field.startedAt) : null,
      last_completed_at: field.lastCompletedAt ? new Date(field.lastCompletedAt) : null,
      last_duration_ms: field.lastDurationMs ?? null,
      last_error: field.lastError ? JSON.stringify(field.lastError) : null,
      extensions: field.extensions ? JSON.stringify(field.extensions) : null,
      updated_at: new Date(field.updatedAt),
    }));
    for (let offset = 0; offset < fieldRows.length; offset += ACTIVITY_WRITE_BATCH_SIZE) {
      await trx
        .insertInto(FIELD_ACTIVITY_TABLE)
        .values(fieldRows.slice(offset, offset + ACTIVITY_WRITE_BATCH_SIZE))
        .onConflict((oc) =>
          oc.column('field_id').doUpdateSet({
            table_id: sql.ref('excluded.table_id'),
            base_id: sql.ref('excluded.base_id'),
            status: sql.ref('excluded.status'),
            active_task_count: sql.ref('excluded.active_task_count'),
            processing_task_count: sql.ref('excluded.processing_task_count'),
            generation: sql.ref('excluded.generation'),
            estimated_complexity: sql.ref('excluded.estimated_complexity'),
            estimated_dirty_records: sql.ref('excluded.estimated_dirty_records'),
            has_all_target_records: sql.ref('excluded.has_all_target_records'),
            queued_at: sql.ref('excluded.queued_at'),
            started_at: sql.ref('excluded.started_at'),
            last_completed_at: sql.ref('excluded.last_completed_at'),
            last_duration_ms: sql.ref('excluded.last_duration_ms'),
            last_error: sql.ref('excluded.last_error'),
            extensions: sql.ref('excluded.extensions'),
            updated_at: sql.ref('excluded.updated_at'),
          })
        )
        .execute();
    }

    const tableRows = changed.tables.map((table) => ({
      table_id: table.tableId,
      base_id: table.baseId,
      status: table.status,
      calculating_field_count: table.calculatingFieldCount,
      queued_field_count: table.queuedFieldCount,
      estimated_complexity: table.estimatedComplexity,
      recent_completions: JSON.stringify(table.recentCompletions),
      generation: table.generation,
      updated_at: new Date(table.updatedAt),
    }));
    for (let offset = 0; offset < tableRows.length; offset += ACTIVITY_WRITE_BATCH_SIZE) {
      await trx
        .insertInto(TABLE_ACTIVITY_TABLE)
        .values(tableRows.slice(offset, offset + ACTIVITY_WRITE_BATCH_SIZE))
        .onConflict((oc) =>
          oc.column('table_id').doUpdateSet({
            base_id: sql.ref('excluded.base_id'),
            status: sql.ref('excluded.status'),
            calculating_field_count: sql.ref('excluded.calculating_field_count'),
            queued_field_count: sql.ref('excluded.queued_field_count'),
            estimated_complexity: sql.ref('excluded.estimated_complexity'),
            recent_completions: sql.ref('excluded.recent_completions'),
            generation: sql.ref('excluded.generation'),
            updated_at: sql.ref('excluded.updated_at'),
          })
        )
        .execute();
    }

    return {
      baseId: changed.fields[0]?.baseId ?? changed.tables[0]?.baseId ?? '',
      fields: changed.fields,
      tables: changed.tables,
    };
  }

  private resolvePublishContext(context?: IExecutionContext): IExecutionContext {
    if (context?.actorId) return context;
    const actorId = ActorId.create('system');
    return {
      actorId: actorId.isOk() ? actorId.value : (undefined as never),
    };
  }

  async publishActivityChanged(
    projection: ComputedActivityProjectionResult | null | undefined,
    context?: IExecutionContext
  ): Promise<void> {
    if (!projection || !this.eventBus) return;
    if (projection.fields.length === 0 && projection.tables.length === 0) return;

    const baseIdResult = BaseId.create(projection.baseId);
    if (baseIdResult.isErr()) return;
    const event = ComputedActivityBatchChanged.create({
      baseId: baseIdResult.value,
      fields: isComputedReliabilityVisible(projection.baseId)
        ? projection.fields
        : projection.fields.map((field) => ({ ...field, reliability: undefined })),
      tables: projection.tables,
    });
    const publishContext = this.resolvePublishContext(context);

    const publish = async () => {
      try {
        const result = await this.eventBus!.publish(publishContext, event);
        if (result.isErr()) {
          this.logger.warn('computed:activity:event_publish_failed', {
            baseId: projection.baseId,
            fieldCount: projection.fields.length,
            error: result.error.message,
          });
        }
      } catch (error) {
        this.logger.warn('computed:activity:event_publish_failed', {
          baseId: projection.baseId,
          fieldCount: projection.fields.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const transaction = getUnitOfWorkTransaction(context, 'data');
    if (transaction) {
      if (context && registerAfterCommit(context, publish)) return;
      this.logger.warn('computed:activity:event_publish_skipped_without_after_commit_hook', {
        baseId: projection.baseId,
        fieldCount: projection.fields.length,
      });
      return;
    }
    await publish();
  }

  private async serializeEnqueueProjection<T>(
    targets: ReadonlyArray<Pick<FieldComputeTarget, 'tableId'>>,
    project: () => Promise<T>,
    onGateTimeout: () => T
  ): Promise<T> {
    const reservations: Array<{
      key: string;
      tail: Promise<void>;
      release: () => void;
    }> = [];
    const keys = [...new Set(targets.map((target) => target.tableId.toString()))].sort();
    const deadline = Date.now() + ENQUEUE_PROJECTION_GATE_TIMEOUT_MS;

    try {
      for (const key of keys) {
        const previous = this.enqueueProjectionTails.get(key) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const tail = previous.then(() => gate);
        this.enqueueProjectionTails.set(key, tail);
        // Reserve before waiting so the finally block always resolves our gate even on
        // timeout; a resolved gate is transparent to waiters chained behind it.
        reservations.push({ key, tail, release });
        const acquired = await waitWithTimeout(previous, deadline - Date.now());
        if (!acquired) {
          this.logger.warn('computed:activity:enqueue_gate_timeout_projection_skipped', {
            tableId: key,
            timeoutMs: ENQUEUE_PROJECTION_GATE_TIMEOUT_MS,
          });
          return onGateTimeout();
        }
      }
      return await project();
    } finally {
      for (const reservation of reservations.reverse()) {
        reservation.release();
        if (this.enqueueProjectionTails.get(reservation.key) === reservation.tail) {
          this.enqueueProjectionTails.delete(reservation.key);
        }
      }
    }
  }

  private async run<T>(
    context: IExecutionContext | undefined,
    fn: (trx: DbLike) => Promise<Result<T, DomainError>>,
    operation: string,
    explicitTrx?: DbLike
  ): Promise<Result<T, DomainError>> {
    try {
      if (explicitTrx) {
        return await fn(explicitTrx);
      }
      const existingTx = getPostgresTransaction(context);
      if (existingTx) {
        return await fn(existingTx as unknown as DbLike);
      }
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      return await db.transaction().execute(async (trx) => {
        const result = await fn(trx as unknown as DbLike);
        if (result.isErr()) throw new ComputedActivityAbort(result.error);
        return result;
      });
    } catch (error) {
      if (error instanceof ComputedActivityAbort) return err(error.error);
      this.logger.warn('computed:activity:projector_failed', {
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
      return err(
        domainError.infrastructure({
          message: `Computed activity projector failed: ${operation}`,
          details: {
            operation,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      );
    }
  }
}
