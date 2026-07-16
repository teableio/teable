import {
  getPostgresTransaction,
  resolvePostgresDbOrTx,
} from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  type DomainError,
  generatePrefixedId,
  getUnitOfWorkTransaction,
  type IExecutionContext,
  type ILogger,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely, type Transaction } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { DynamicDB } from '../../query-builder';
import type { DirtyRecordStats } from '../ComputedFieldUpdater';
import { buildTryAdvisoryLockQuery } from '../ComputedUpdateLock';
import { toErrorLogFields } from '../errorLog';
import { buildComputedTaskNotPausedCondition } from '../pause/ComputedUpdatePauseRegistry';
import { COMPUTED_UPDATE_PAUSE_SCOPE_TABLE } from '../pause/IComputedUpdatePauseRegistry';
import {
  createComputedOutboxWakeup,
  noopComputedOutboxWakeupPublisher,
  type ComputedOutboxWakeupCause,
  type IComputedOutboxWakeupPublisher,
} from './ComputedOutboxWakeup';
import type {
  ComputedRealtimeOrchestrationDto,
  ComputedUpdateOutboxItem,
  ComputedUpdateOutboxTaskInput,
} from './ComputedUpdateOutboxPayload';
import {
  mergeBeforeImageRecordDtos,
  mergeComputedRealtimeOrchestration,
} from './ComputedUpdateOutboxPayload';
import type { ComputedUpdateSeedTaskInput } from './ComputedUpdateSeedPayload';
import { mergeSeedPayloads } from './ComputedUpdateSeedPayload';
import type { FieldBackfillOutboxTaskInput } from './FieldBackfillOutboxPayload';
import {
  defaultComputedUpdateOutboxConfig,
  isFieldBackfillOutboxItem,
  isSeedOutboxItem,
} from './IComputedUpdateOutbox';
import type {
  OutboxTaskClaimEligibility,
  IComputedUpdateOutbox,
  ClaimBatchParams,
  ClaimByIdParams,
  RenewLeaseParams,
  ReleaseForRetryParams,
  ComputedUpdateOutboxConfig,
  AnyOutboxItem,
  FieldBackfillOutboxItem,
  SeedOutboxItem,
  MarkFailedOptions,
} from './IComputedUpdateOutbox';

const OUTBOX_TABLE = 'computed_update_outbox';
const OUTBOX_SEED_TABLE = 'computed_update_outbox_seed';
const DEAD_LETTER_TABLE = 'computed_update_dead_letter';
const PENDING_SEED_UNIQUE_INDEX = 'computed_update_outbox_pending_unique_idx';

const DEFAULT_STATUS = 'pending';
const OUTBOX_ID_PREFIX = 'cuo';
const OUTBOX_ID_BODY_LENGTH = 16;
const OUTBOX_SEED_ID_PREFIX = 'cus';
const OUTBOX_SEED_ID_BODY_LENGTH = 16;
const OUTBOX_CLAIM_ID_PREFIX = 'cuc';
const OUTBOX_CLAIM_ID_BODY_LENGTH = 10;
const OUTBOX_CLAIM_ADVISORY_LOCK_KEY = 'v2:outbox:claim:global';

/** Change type for field backfill tasks (stored in change_type column) */
const FIELD_BACKFILL_CHANGE_TYPE = 'field-backfill';

/** Change type for seed tasks (stored in change_type column) */
const SEED_CHANGE_TYPE = 'seed';

const createOutboxId = (): string => generatePrefixedId(OUTBOX_ID_PREFIX, OUTBOX_ID_BODY_LENGTH);
const createOutboxSeedId = (): string =>
  generatePrefixedId(OUTBOX_SEED_ID_PREFIX, OUTBOX_SEED_ID_BODY_LENGTH);
const createClaimOwner = (workerId: string): string =>
  `${workerId}:${generatePrefixedId(OUTBOX_CLAIM_ID_PREFIX, OUTBOX_CLAIM_ID_BODY_LENGTH)}`;

export type OutboxRow = Record<string, unknown>;

const getClaimLockScope = (row: OutboxRow): string =>
  `${String(row.base_id)}:${String(row.seed_table_id)}`;

export const dedupeClaimRowsByScope = <T extends OutboxRow>(rows: ReadonlyArray<T>): T[] => {
  const seen = new Set<string>();
  const selected: T[] = [];

  for (const row of rows) {
    const scope = getClaimLockScope(row);
    if (seen.has(scope)) continue;
    seen.add(scope);
    selected.push(row);
  }

  return selected;
};

const buildProcessingConcurrencyCondition = (
  alias: string,
  reclaimBefore: Date,
  config: ComputedUpdateOutboxConfig
) => sql<boolean>`
  (
    select count(*)::int
    from ${sql.table(OUTBOX_TABLE)} as active
    where active."status" = 'processing'
      and active."locked_at" is not null
      and active."locked_at" > ${reclaimBefore}
      and active."base_id" = ${sql.ref(`${alias}.base_id`)}
  ) < ${config.maxConcurrentProcessingPerBase}
  and (
    select count(*)::int
    from ${sql.table(OUTBOX_TABLE)} as active
    where active."status" = 'processing'
      and active."locked_at" is not null
      and active."locked_at" > ${reclaimBefore}
      and active."base_id" = ${sql.ref(`${alias}.base_id`)}
      and active."seed_table_id" = ${sql.ref(`${alias}.seed_table_id`)}
  ) < ${config.maxConcurrentProcessingPerSeedTable}
`;

type SeedRecord = {
  tableId: string;
  recordId: string;
};

type SeedGroup = {
  tableId: string;
  recordIds: string[];
};

type SeedRow = {
  task_id: string;
  table_id: string;
  record_id: string;
};

type RunInTransactionOptions = {
  logger?: ILogger;
  operation?: string;
  logContext?: Record<string, unknown>;
};

type OutboxClaimDeferral = Extract<OutboxTaskClaimEligibility, { status: 'deferred' }>;

/**
 * Persist computed update tasks for background processing (outbox pattern).
 *
 * Example
 * ```typescript
 * const result = await outbox.enqueueOrMerge(task, context);
 * if (result.isOk()) {
 *   const claimed = await outbox.claimBatch({ workerId: 'worker-1', limit: 10 });
 * }
 * ```
 */
@injectable()
export class ComputedUpdateOutbox implements IComputedUpdateOutbox {
  private pendingSeedUniqueIndexAvailable?: boolean;

  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig)
    private readonly config: ComputedUpdateOutboxConfig = defaultComputedUpdateOutboxConfig,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2RecordRepositoryPostgresTokens.metaDb)
    private readonly metaDb: Kysely<V1TeableDatabase> = db,
    @inject(v2RecordRepositoryPostgresTokens.computedOutboxWakeupPublisher)
    private readonly wakeupPublisher: IComputedOutboxWakeupPublisher = noopComputedOutboxWakeupPublisher
  ) {}

  private async scheduleWakeup(
    params: {
      taskId: string;
      baseId: string;
      availableAt?: Date;
      cause: ComputedOutboxWakeupCause;
    },
    context?: IExecutionContext
  ): Promise<void> {
    const wakeup = createComputedOutboxWakeup(params);
    const publishSafely = async () => {
      try {
        const outcome = await this.wakeupPublisher.publish(wakeup);
        if (outcome.status === 'disabled') return;
        this.logger.debug('computed:outbox:wakeup_published', {
          taskId: wakeup.taskId,
          baseId: wakeup.baseId,
          wakeupId: wakeup.wakeupId,
          availableAt: wakeup.availableAt,
          cause: wakeup.cause,
        });
      } catch (error) {
        this.wakeupPublisher.recordSkip?.('publish_failed');
        this.logger.warn('computed:outbox:wakeup_publish_failed', {
          taskId: wakeup.taskId,
          baseId: wakeup.baseId,
          wakeupId: wakeup.wakeupId,
          cause: wakeup.cause,
          ...toErrorLogFields(error),
        });
      }
    };

    const transaction = getUnitOfWorkTransaction(context, 'data');
    if (transaction) {
      if (transaction.afterCommit) {
        transaction.afterCommit(publishSafely);
      } else {
        this.wakeupPublisher.recordSkip?.('no_after_commit');
        this.logger.warn('computed:outbox:wakeup_skipped_without_after_commit_hook', {
          taskId: wakeup.taskId,
          baseId: wakeup.baseId,
          wakeupId: wakeup.wakeupId,
          cause: wakeup.cause,
        });
      }
      return;
    }
    await publishSafely();
  }

  async enqueueOrMerge(
    task: ComputedUpdateOutboxTaskInput,
    context?: IExecutionContext
  ): Promise<Result<{ taskId: string; merged: boolean }, DomainError>> {
    const span = context?.tracer?.startSpan('teable.outbox.enqueueOrMerge', {
      'outbox.baseId': task.baseId,
      'outbox.seedTableId': task.seedTableId,
      'outbox.changeType': task.changeType,
    });

    const executeEnqueue = async (): Promise<
      Result<{ taskId: string; merged: boolean }, DomainError>
    > => {
      const now = new Date();
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;

      return runInTransaction<{ taskId: string; merged: boolean }>(
        db,
        context,
        async (trx) => {
          await acquireOutboxAdvisoryLock(
            trx,
            buildOutboxLockKey({
              baseId: task.baseId,
              seedTableId: task.seedTableId,
              planHash: task.planHash,
              changeType: task.changeType,
            })
          );
          const existing = await trx
            .selectFrom(OUTBOX_TABLE)
            .selectAll()
            .where('base_id', '=', task.baseId)
            .where('seed_table_id', '=', task.seedTableId)
            .where('plan_hash', '=', task.planHash)
            .where('change_type', '=', task.changeType)
            .where('status', '=', DEFAULT_STATUS)
            .forUpdate()
            .executeTakeFirst();

          if (!existing) {
            const taskId = await this.insertOutbox(trx, task, now);
            return ok({ taskId, merged: false });
          }

          const taskId = await this.mergeComputedTask(trx, existing, task, now);

          return ok({ taskId, merged: true });
        },
        {
          logger: this.logger,
          operation: 'enqueue_or_merge',
          logContext: {
            baseId: task.baseId,
            seedTableId: task.seedTableId,
            changeType: task.changeType,
          },
        }
      );
    };

    try {
      let result: Result<{ taskId: string; merged: boolean }, DomainError>;
      if (span && context?.tracer) {
        result = await context.tracer.withSpan(span, executeEnqueue);
      } else {
        result = await executeEnqueue();
      }
      if (result.isOk()) {
        await this.scheduleWakeup(
          {
            taskId: result.value.taskId,
            baseId: task.baseId,
            cause: result.value.merged ? 'merged' : 'created',
          },
          context
        );
      }
      return result;
    } finally {
      span?.end();
    }
  }

  async enqueueFieldBackfill(
    task: FieldBackfillOutboxTaskInput,
    context?: IExecutionContext
  ): Promise<Result<{ taskId: string; merged: boolean }, DomainError>> {
    const span = context?.tracer?.startSpan('teable.outbox.enqueueFieldBackfill', {
      'outbox.baseId': task.baseId,
      'outbox.tableId': task.tableId,
      'outbox.fieldCount': task.fieldIds.length,
    });

    const executeEnqueue = async (): Promise<
      Result<{ taskId: string; merged: boolean }, DomainError>
    > => {
      const now = new Date();
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;

      return runInTransaction<{ taskId: string; merged: boolean }>(
        db,
        context,
        async (trx) => {
          await acquireOutboxAdvisoryLock(
            trx,
            buildOutboxLockKey({
              baseId: task.baseId,
              seedTableId: task.tableId,
              planHash: task.planHash,
              changeType: FIELD_BACKFILL_CHANGE_TYPE,
            })
          );
          // Check for existing pending backfill task for same table/fields
          const existing = await trx
            .selectFrom(OUTBOX_TABLE)
            .selectAll()
            .where('base_id', '=', task.baseId)
            .where('seed_table_id', '=', task.tableId)
            .where('plan_hash', '=', task.planHash)
            .where('change_type', '=', FIELD_BACKFILL_CHANGE_TYPE)
            .where('status', '=', DEFAULT_STATUS)
            .forUpdate()
            .executeTakeFirst();

          if (!existing) {
            const taskId = await this.insertFieldBackfill(trx, task, now);
            return ok({ taskId, merged: false });
          }

          // Merge field IDs with existing task
          const taskId = String(existing.id);
          const existingFieldIds = parseStringArray(existing.affected_field_ids);
          const mergedFieldIds = [...new Set([...existingFieldIds, ...task.fieldIds])];

          await trx
            .updateTable(OUTBOX_TABLE)
            .set({
              affected_field_ids: mergedFieldIds,
              next_run_at: now,
              updated_at: now,
            })
            .where('id', '=', taskId)
            .execute();

          this.logger.debug('computed:outbox:field_backfill_merged', {
            taskId,
            fieldIds: mergedFieldIds,
          });

          return ok({ taskId, merged: true });
        },
        {
          logger: this.logger,
          operation: 'enqueue_field_backfill',
          logContext: {
            baseId: task.baseId,
            tableId: task.tableId,
            changeType: FIELD_BACKFILL_CHANGE_TYPE,
          },
        }
      );
    };

    try {
      let result: Result<{ taskId: string; merged: boolean }, DomainError>;
      if (span && context?.tracer) {
        result = await context.tracer.withSpan(span, executeEnqueue);
      } else {
        result = await executeEnqueue();
      }
      if (result.isOk()) {
        await this.scheduleWakeup(
          {
            taskId: result.value.taskId,
            baseId: task.baseId,
            cause: result.value.merged ? 'merged' : 'created',
          },
          context
        );
      }
      return result;
    } finally {
      span?.end();
    }
  }

  async enqueueSeedTask(
    task: ComputedUpdateSeedTaskInput,
    context?: IExecutionContext
  ): Promise<Result<{ taskId: string; merged: boolean }, DomainError>> {
    const span = context?.tracer?.startSpan('teable.outbox.enqueueSeedTask', {
      'outbox.baseId': task.baseId,
      'outbox.seedTableId': task.seedTableId,
      'outbox.changeType': task.changeType,
      'outbox.seedCount': task.seedRecordIds.length,
    });

    const executeEnqueue = async (): Promise<
      Result<{ taskId: string; merged: boolean }, DomainError>
    > => {
      const now = new Date();
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;

      return runInTransaction<{ taskId: string; merged: boolean }>(
        db,
        context,
        async (trx) => {
          await acquireOutboxAdvisoryLock(
            trx,
            buildOutboxLockKey({
              baseId: task.baseId,
              seedTableId: task.seedTableId,
              planHash: task.planHash,
              changeType: SEED_CHANGE_TYPE,
            })
          );
          const existing = await this.findPendingSeedTask(trx, task);

          if (!existing) {
            const taskId = await this.insertSeedTask(trx, task, now);
            if (taskId) {
              return ok({ taskId, merged: false });
            }

            const conflicted = await this.findPendingSeedTask(trx, task);
            if (!conflicted) {
              return err(
                domainError.infrastructure({
                  message: 'Failed to merge seed task after pending outbox conflict',
                })
              );
            }

            const mergedTaskId = await this.mergeSeedTask(trx, conflicted, task, now);
            return ok({ taskId: mergedTaskId, merged: true });
          }

          const taskId = await this.mergeSeedTask(trx, existing, task, now);
          return ok({ taskId, merged: true });
        },
        {
          logger: this.logger,
          operation: 'enqueue_seed',
          logContext: {
            baseId: task.baseId,
            seedTableId: task.seedTableId,
            changeType: SEED_CHANGE_TYPE,
          },
        }
      );
    };

    try {
      let result: Result<{ taskId: string; merged: boolean }, DomainError>;
      if (span && context?.tracer) {
        result = await context.tracer.withSpan(span, executeEnqueue);
      } else {
        result = await executeEnqueue();
      }
      if (result.isOk()) {
        await this.scheduleWakeup(
          {
            taskId: result.value.taskId,
            baseId: task.baseId,
            cause: result.value.merged ? 'merged' : 'created',
          },
          context
        );
      }
      return result;
    } finally {
      span?.end();
    }
  }

  async claimBatch(
    params: ClaimBatchParams,
    context?: IExecutionContext
  ): Promise<Result<ReadonlyArray<AnyOutboxItem>, DomainError>> {
    const span = context?.tracer?.startSpan('teable.outbox.claimBatch', {
      'outbox.workerId': params.workerId,
      'outbox.limit': params.limit,
    });

    const executeClaim = async (): Promise<Result<ReadonlyArray<AnyOutboxItem>, DomainError>> => {
      const now = params.now ?? new Date();
      const reclaimBefore = new Date(now.getTime() - this.config.processingLeaseMs);
      const reclaimLimit = Math.min(params.limit, this.config.reclaimBatchSize);
      const claimOwner = createClaimOwner(params.workerId);
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      const includeSpaceScopeInSql = this.db === this.metaDb;

      return runInTransaction(
        db,
        context,
        async (trx) => {
          await acquireOutboxAdvisoryLock(trx, OUTBOX_CLAIM_ADVISORY_LOCK_KEY);
          const staleRows =
            reclaimLimit > 0
              ? await trx
                  .selectFrom(`${OUTBOX_TABLE} as o`)
                  .selectAll('o')
                  .where('o.status', '=', 'processing')
                  .where(sql<boolean>`("locked_at" is null or "locked_at" <= ${reclaimBefore})`)
                  .where(
                    buildComputedTaskNotPausedCondition('o', now, {
                      includeSpaceScope: includeSpaceScopeInSql,
                    })
                  )
                  .orderBy('locked_at', 'asc')
                  .orderBy('created_at', 'asc')
                  .limit(reclaimLimit)
                  .forUpdate()
                  .skipLocked()
                  .execute()
              : [];

          const remaining = Math.max(params.limit - staleRows.length, 0);
          const pendingRows =
            remaining > 0
              ? await trx
                  .selectFrom(`${OUTBOX_TABLE} as o`)
                  .selectAll('o')
                  .where('o.status', '=', DEFAULT_STATUS)
                  .where('o.next_run_at', '<=', now)
                  .where(
                    buildComputedTaskNotPausedCondition('o', now, {
                      includeSpaceScope: includeSpaceScopeInSql,
                    })
                  )
                  .where(buildProcessingConcurrencyCondition('o', reclaimBefore, this.config))
                  .orderBy('o.estimated_complexity', 'asc')
                  .orderBy('o.next_run_at', 'asc')
                  .orderBy('o.created_at', 'asc')
                  .limit(remaining)
                  .forUpdate()
                  .skipLocked()
                  .execute()
              : [];

          const candidateRows = dedupeClaimRowsByScope([...staleRows, ...pendingRows]);
          const unpausedRows = includeSpaceScopeInSql
            ? candidateRows
            : await this.filterRowsPausedBySpace(trx, candidateRows, now, context);
          const rows = await this.filterRowsByConcurrency(trx, unpausedRows, reclaimBefore);

          if (rows.length === 0) return ok([]);

          const ids = rows.map((row) => String(row.id));
          await trx
            .updateTable(OUTBOX_TABLE)
            .set({
              status: 'processing',
              locked_at: now,
              locked_by: claimOwner,
              updated_at: now,
            })
            .where('id', 'in', ids)
            .execute();

          const seedMap = await this.loadSeedRecords(trx, rows);
          const tasks = rows.map((row) =>
            toAnyOutboxItem(
              {
                ...row,
                status: 'processing',
                locked_at: now,
                locked_by: claimOwner,
                updated_at: now,
              },
              seedMap.get(String(row.id)) ?? []
            )
          );

          this.logger.debug('computed:outbox:claimed', {
            workerId: params.workerId,
            leaseOwner: claimOwner,
            claimedCount: rows.length,
            pendingCount: pendingRows.length,
            reclaimedCount: staleRows.length,
            taskIds: ids,
          });

          if (staleRows.length > 0) {
            this.logger.warn('computed:outbox:stale_processing_reclaimed', {
              workerId: params.workerId,
              leaseOwner: claimOwner,
              reclaimedCount: staleRows.length,
              processingLeaseMs: this.config.processingLeaseMs,
              reclaimBefore,
              taskIds: staleRows.map((row) => String(row.id)),
            });
          }

          return ok(tasks);
        },
        {
          logger: this.logger,
          operation: 'claim_batch',
          logContext: { workerId: params.workerId, limit: params.limit },
        }
      );
    };

    try {
      if (span && context?.tracer) {
        return await context.tracer.withSpan(span, executeClaim);
      }
      return await executeClaim();
    } finally {
      span?.end();
    }
  }

  private async filterRowsPausedBySpace(
    db: Kysely<DynamicDB> | Transaction<DynamicDB>,
    rows: ReadonlyArray<OutboxRow>,
    now: Date,
    context?: IExecutionContext
  ): Promise<OutboxRow[]> {
    if (rows.length === 0) return [];

    const pausedSpaceRows = (await db
      .selectFrom(COMPUTED_UPDATE_PAUSE_SCOPE_TABLE)
      .select('scope_id')
      .where('scope_type', '=', 'space')
      .where((eb) => eb.or([eb('resume_at', 'is', null), eb('resume_at', '>', now)]))
      .execute()) as Array<{ scope_id: string }>;

    const pausedSpaceIds = new Set(pausedSpaceRows.map((row) => String(row.scope_id)));
    if (pausedSpaceIds.size === 0) return [...rows];

    const baseIds = [...new Set(rows.map((row) => String(row.base_id)))];
    if (baseIds.length === 0) return [...rows];

    const metaDb = resolvePostgresDbOrTx(
      this.metaDb,
      context,
      'meta'
    ) as unknown as Kysely<DynamicDB>;
    const baseRows = (await metaDb
      .selectFrom('base')
      .select(['id', 'space_id'])
      .where('id', 'in', baseIds)
      .execute()) as Array<{ id: string; space_id: string | null }>;

    const pausedBaseIds = new Set(
      baseRows
        .filter((row) => row.space_id != null && pausedSpaceIds.has(String(row.space_id)))
        .map((row) => String(row.id))
    );

    return rows.filter((row) => !pausedBaseIds.has(String(row.base_id)));
  }

  private async filterRowsByConcurrency(
    db: Kysely<DynamicDB> | Transaction<DynamicDB>,
    rows: ReadonlyArray<OutboxRow>,
    reclaimBefore: Date
  ): Promise<OutboxRow[]> {
    if (rows.length === 0) return [];

    const baseIds = [...new Set(rows.map((row) => String(row.base_id)))];
    const activeRows = (await db
      .selectFrom(OUTBOX_TABLE)
      .select(['base_id', 'seed_table_id'])
      .where('status', '=', 'processing')
      .where('locked_at', 'is not', null)
      .where('locked_at', '>', reclaimBefore)
      .where('base_id', 'in', baseIds)
      .execute()) as OutboxRow[];

    const activeByBase = new Map<string, number>();
    const activeBySeed = new Map<string, number>();
    for (const row of activeRows) {
      const baseId = String(row.base_id);
      const seedScope = getClaimLockScope(row);
      activeByBase.set(baseId, (activeByBase.get(baseId) ?? 0) + 1);
      activeBySeed.set(seedScope, (activeBySeed.get(seedScope) ?? 0) + 1);
    }

    const selected: OutboxRow[] = [];
    for (const row of rows) {
      const baseId = String(row.base_id);
      const seedScope = getClaimLockScope(row);
      const baseCount = activeByBase.get(baseId) ?? 0;
      const seedCount = activeBySeed.get(seedScope) ?? 0;
      if (
        baseCount >= this.config.maxConcurrentProcessingPerBase ||
        seedCount >= this.config.maxConcurrentProcessingPerSeedTable
      ) {
        continue;
      }
      selected.push(row);
      activeByBase.set(baseId, baseCount + 1);
      activeBySeed.set(seedScope, seedCount + 1);
    }
    return selected;
  }

  async claimById(
    params: ClaimByIdParams,
    context?: IExecutionContext
  ): Promise<Result<AnyOutboxItem | null, DomainError>> {
    const span = context?.tracer?.startSpan('teable.outbox.claimById', {
      'outbox.taskId': params.taskId,
      'outbox.workerId': params.workerId,
    });

    const executeClaim = async (): Promise<Result<AnyOutboxItem | null, DomainError>> => {
      const now = params.now ?? new Date();
      const reclaimBefore = new Date(now.getTime() - this.config.processingLeaseMs);
      const claimOwner = createClaimOwner(params.workerId);
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;

      return runInTransaction(
        db,
        context,
        async (trx) => {
          let row: OutboxRow | undefined;
          if (params.allowProcessingTakeover) {
            row = await trx
              .selectFrom(`${OUTBOX_TABLE} as o`)
              .selectAll('o')
              .where('o.id', '=', params.taskId)
              .where('o.status', 'in', [DEFAULT_STATUS, 'processing'])
              .forUpdate()
              .skipLocked()
              .executeTakeFirst();
          } else {
            const locator = await trx
              .selectFrom(`${OUTBOX_TABLE} as o`)
              .select('o.base_id')
              .where('o.id', '=', params.taskId)
              .where('o.status', 'in', [DEFAULT_STATUS, 'processing'])
              .executeTakeFirst();
            if (!locator) return ok(null);

            // BullMQ locators are best-effort hints. Never queue sessions behind a busy base;
            // the handler will re-arm this durable task after a fast miss.
            const acquired = await tryAcquireOutboxAdvisoryLock(
              trx,
              `v2:outbox:claim:base:${String(locator.base_id)}`
            );
            if (!acquired) return ok(null);
            const candidate = await trx
              .selectFrom(`${OUTBOX_TABLE} as o`)
              .selectAll('o')
              .where('o.id', '=', params.taskId)
              .where('o.status', 'in', [DEFAULT_STATUS, 'processing'])
              .forUpdate()
              .skipLocked()
              .executeTakeFirst();
            if (candidate) {
              const deferral = await this.getClaimDeferral(
                trx,
                candidate,
                now,
                reclaimBefore,
                context
              );
              if (!deferral) row = candidate;
            }
          }

          if (!row) return ok(null);

          await trx
            .updateTable(OUTBOX_TABLE)
            .set({
              status: 'processing',
              locked_at: now,
              locked_by: claimOwner,
              updated_at: now,
            })
            .where('id', '=', params.taskId)
            .where('status', '=', String(row.status))
            .execute();

          const seedMap = await this.loadSeedRecords(trx, [row]);
          const claimedRow = {
            ...row,
            status: 'processing',
            locked_at: now,
            locked_by: claimOwner,
            updated_at: now,
          };

          if (String(row.status) === 'processing') {
            this.logger.warn('computed:outbox:processing_taken_over', {
              taskId: params.taskId,
              workerId: params.workerId,
              previousLeaseOwner: row.locked_by ? String(row.locked_by) : null,
              newLeaseOwner: claimOwner,
            });
          }

          return ok(toAnyOutboxItem(claimedRow, seedMap.get(String(row.id)) ?? []));
        },
        {
          logger: this.logger,
          operation: 'claim_by_id',
          logContext: { workerId: params.workerId, taskId: params.taskId },
        }
      );
    };

    try {
      if (span && context?.tracer) {
        return await context.tracer.withSpan(span, executeClaim);
      }
      return await executeClaim();
    } finally {
      span?.end();
    }
  }

  async getTaskClaimEligibility(
    taskId: string,
    context?: IExecutionContext
  ): Promise<Result<OutboxTaskClaimEligibility | null, DomainError>> {
    try {
      const now = new Date();
      const reclaimBefore = new Date(now.getTime() - this.config.processingLeaseMs);
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      const row = (await db
        .selectFrom(OUTBOX_TABLE)
        .select([
          'status',
          'next_run_at',
          'locked_at',
          'base_id',
          'seed_table_id',
          'affected_table_ids',
        ])
        .where('id', '=', taskId)
        .executeTakeFirst()) as OutboxRow | undefined;
      if (!row) return ok(null);

      const status = String(row.status);
      if (status === 'done' || status === 'dead') return ok({ status: 'terminal' });
      if (status !== DEFAULT_STATUS && status !== 'processing') return ok(null);

      const deferral = await this.getClaimDeferral(db, row, now, reclaimBefore, context);
      return ok(deferral ?? { status: 'eligible' });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to inspect outbox task claim eligibility for ${taskId}: ${describeError(error)}`,
        })
      );
    }
  }

  private async getClaimDeferral(
    db: Kysely<DynamicDB> | Transaction<DynamicDB>,
    row: OutboxRow,
    now: Date,
    reclaimBefore: Date,
    context?: IExecutionContext
  ): Promise<OutboxClaimDeferral | null> {
    const status = String(row.status);
    if (status === DEFAULT_STATUS) {
      const nextRunAt = new Date(row.next_run_at as Date | string);
      if (nextRunAt.getTime() > now.getTime()) {
        return { status: 'deferred', reason: 'not_due', retryAt: nextRunAt };
      }
    } else if (status === 'processing' && row.locked_at != null) {
      const lockedAt = new Date(row.locked_at as Date | string);
      if (lockedAt.getTime() > reclaimBefore.getTime()) {
        return {
          status: 'deferred',
          reason: 'active_lease',
          retryAt: new Date(lockedAt.getTime() + this.config.processingLeaseMs),
        };
      }
    }

    const pauseRetryAt = await this.getPauseRetryAt(db, row, now, context);
    if (pauseRetryAt !== undefined) {
      return { status: 'deferred', reason: 'paused', retryAt: pauseRetryAt };
    }

    const concurrencyRetryAt = await this.getConcurrencyRetryAt(db, row, reclaimBefore);
    if (concurrencyRetryAt !== undefined) {
      return { status: 'deferred', reason: 'concurrency', retryAt: concurrencyRetryAt };
    }

    return null;
  }

  private async getPauseRetryAt(
    db: Kysely<DynamicDB> | Transaction<DynamicDB>,
    row: OutboxRow,
    now: Date,
    context?: IExecutionContext
  ): Promise<Date | null | undefined> {
    const activePauses = (await db
      .selectFrom(COMPUTED_UPDATE_PAUSE_SCOPE_TABLE)
      .select(['scope_type', 'scope_id', 'resume_at'])
      .where((eb) => eb.or([eb('resume_at', 'is', null), eb('resume_at', '>', now)]))
      .execute()) as Array<{
      scope_type: string;
      scope_id: string;
      resume_at: Date | string | null;
    }>;
    if (activePauses.length === 0) return undefined;

    const tableIds = new Set<string>([
      String(row.seed_table_id),
      ...((row.affected_table_ids as string[] | null) ?? []).map(String),
    ]);
    let spaceId: string | null = null;
    if (activePauses.some((pause) => pause.scope_type === 'space')) {
      const metaDb = resolvePostgresDbOrTx(
        this.metaDb,
        context,
        'meta'
      ) as unknown as Kysely<DynamicDB>;
      const base = (await metaDb
        .selectFrom('base')
        .select('space_id')
        .where('id', '=', String(row.base_id))
        .executeTakeFirst()) as { space_id: string | null } | undefined;
      spaceId = base?.space_id == null ? null : String(base.space_id);
    }

    const matching = activePauses.filter(
      (pause) =>
        (pause.scope_type === 'base' && pause.scope_id === String(row.base_id)) ||
        (pause.scope_type === 'table' && tableIds.has(pause.scope_id)) ||
        (pause.scope_type === 'space' && spaceId != null && pause.scope_id === spaceId)
    );
    if (matching.length === 0) return undefined;
    if (matching.some((pause) => pause.resume_at == null)) return null;
    return new Date(
      Math.max(...matching.map((pause) => new Date(pause.resume_at as Date | string).getTime()))
    );
  }

  private async getConcurrencyRetryAt(
    db: Kysely<DynamicDB> | Transaction<DynamicDB>,
    row: OutboxRow,
    reclaimBefore: Date
  ): Promise<Date | undefined> {
    const activeRows = (await db
      .selectFrom(OUTBOX_TABLE)
      .select(['base_id', 'seed_table_id', 'locked_at'])
      .where('status', '=', 'processing')
      .where('locked_at', 'is not', null)
      .where('locked_at', '>', reclaimBefore)
      .where('base_id', '=', String(row.base_id))
      .execute()) as OutboxRow[];
    const sameSeedRows = activeRows.filter(
      (active) => String(active.seed_table_id) === String(row.seed_table_id)
    );
    const baseBlocked = activeRows.length >= this.config.maxConcurrentProcessingPerBase;
    const seedBlocked = sameSeedRows.length >= this.config.maxConcurrentProcessingPerSeedTable;
    if (!baseBlocked && !seedBlocked) return undefined;

    const blockers = [...(baseBlocked ? activeRows : []), ...(seedBlocked ? sameSeedRows : [])];
    return new Date(
      Math.max(
        ...blockers.map(
          (active) =>
            new Date(active.locked_at as Date | string).getTime() + this.config.processingLeaseMs
        )
      )
    );
  }

  async renewLease(
    params: RenewLeaseParams,
    context?: IExecutionContext
  ): Promise<Result<ReadonlyArray<string>, DomainError>> {
    const taskIds = [...new Set(params.taskIds)].filter(Boolean);
    if (taskIds.length === 0) return ok([]);

    const span = context?.tracer?.startSpan('teable.outbox.renewLease', {
      'outbox.taskCount': taskIds.length,
      'outbox.leaseOwner': params.leaseOwner,
    });

    const executeRenew = async (): Promise<Result<ReadonlyArray<string>, DomainError>> => {
      const now = params.now ?? new Date();
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      return runInTransaction(
        db,
        context,
        async (trx) => {
          const renewed = await trx
            .updateTable(OUTBOX_TABLE)
            .set({
              locked_at: now,
              updated_at: now,
            })
            .where('id', 'in', taskIds)
            .where('status', '=', 'processing')
            .where('locked_by', '=', params.leaseOwner)
            .returning('id')
            .execute();

          return ok(renewed.map((row) => String(row.id)));
        },
        {
          logger: this.logger,
          operation: 'renew_lease',
          logContext: { taskIds, leaseOwner: params.leaseOwner },
        }
      );
    };

    try {
      if (span && context?.tracer) {
        return await context.tracer.withSpan(span, executeRenew);
      }
      return await executeRenew();
    } finally {
      span?.end();
    }
  }

  async markDone(
    taskOrId: AnyOutboxItem | string,
    context?: IExecutionContext
  ): Promise<Result<boolean, DomainError>> {
    const taskId = typeof taskOrId === 'string' ? taskOrId : taskOrId.id;
    const leaseOwner = typeof taskOrId === 'string' ? null : taskOrId.lockedBy ?? null;
    const span = context?.tracer?.startSpan('teable.outbox.markDone', {
      'outbox.taskId': taskId,
    });

    const executeMarkDone = async (): Promise<Result<boolean, DomainError>> => {
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      return runInTransaction(
        db,
        context,
        async (trx) => {
          const deleted = leaseOwner
            ? await trx
                .deleteFrom(OUTBOX_TABLE)
                .where('id', '=', taskId)
                .where('status', '=', 'processing')
                .where('locked_by', '=', leaseOwner)
                .returning('id')
                .execute()
            : await trx.deleteFrom(OUTBOX_TABLE).where('id', '=', taskId).returning('id').execute();

          if (deleted.length === 0) {
            if (leaseOwner) {
              this.logger.warn('computed:outbox:markDone_skipped_owner_mismatch', {
                taskId,
                leaseOwner,
              });
            }
            return ok(false);
          }

          await trx.deleteFrom(OUTBOX_SEED_TABLE).where('task_id', '=', taskId).execute();
          return ok(true);
        },
        {
          logger: this.logger,
          operation: 'mark_done',
          logContext: { taskId, leaseOwner },
        }
      );
    };

    try {
      if (span && context?.tracer) {
        return await context.tracer.withSpan(span, executeMarkDone);
      }
      return await executeMarkDone();
    } finally {
      span?.end();
    }
  }

  async releaseForRetry(
    params: ReleaseForRetryParams,
    context?: IExecutionContext
  ): Promise<Result<boolean, DomainError>> {
    const span = context?.tracer?.startSpan('teable.outbox.releaseForRetry', {
      'outbox.taskId': params.task.id,
    });

    type ReleaseOutcome = {
      released: boolean;
      taskId?: string;
      availableAt?: Date;
    };
    const executeRelease = async (): Promise<Result<ReleaseOutcome, DomainError>> => {
      const now = params.now ?? new Date();
      const retryDelayMs = Math.max(
        0,
        Math.trunc(params.retryDelayMs ?? this.config.baseBackoffMs)
      );
      const nextRunAt = new Date(now.getTime() + retryDelayMs);
      const leaseOwner = params.task.lockedBy ?? null;
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      const lockKey = buildOutboxLockKey({
        baseId: params.task.baseId,
        seedTableId: getOutboxRowSeedTableId(params.task),
        planHash: params.task.planHash,
        changeType: getOutboxRowChangeType(params.task),
      });

      return runInTransaction<ReleaseOutcome>(
        db,
        context,
        async (trx) => {
          await acquireOutboxAdvisoryLock(trx, lockKey);

          if (leaseOwner) {
            const ownedRow = await trx
              .selectFrom(OUTBOX_TABLE)
              .selectAll()
              .where('id', '=', params.task.id)
              .where('status', '=', 'processing')
              .where('locked_by', '=', leaseOwner)
              .forUpdate()
              .executeTakeFirst();

            if (!ownedRow) {
              this.logger.warn('computed:outbox:release_retry_skipped_owner_mismatch', {
                taskId: params.task.id,
                leaseOwner,
              });
              return ok({ released: false });
            }
          }

          const pending = await trx
            .selectFrom(OUTBOX_TABLE)
            .selectAll()
            .where('base_id', '=', params.task.baseId)
            .where('seed_table_id', '=', getOutboxRowSeedTableId(params.task))
            .where('plan_hash', '=', params.task.planHash)
            .where('change_type', '=', getOutboxRowChangeType(params.task))
            .where('status', '=', DEFAULT_STATUS)
            .forUpdate()
            .executeTakeFirst();

          if (pending && String(pending.id) !== params.task.id) {
            const mergedTaskId = await this.mergeRetryTaskIntoPending(
              trx,
              pending,
              params.task,
              now
            );
            const removed = await this.deleteOwnedProcessingTask(trx, params.task.id, leaseOwner);
            if (!removed) {
              this.logger.warn('computed:outbox:release_retry_skipped_owner_mismatch', {
                taskId: params.task.id,
                leaseOwner,
              });
              return ok({ released: false });
            }

            this.logger.debug('computed:outbox:release_retry_merged_pending', {
              taskId: params.task.id,
              mergedTaskId,
              reason: params.reason,
              nextRunAt,
            });

            return ok({ released: true, taskId: mergedTaskId, availableAt: now });
          }

          await trx
            .updateTable(OUTBOX_TABLE)
            .set({
              status: DEFAULT_STATUS,
              next_run_at: nextRunAt,
              last_error: params.reason,
              locked_at: null,
              locked_by: null,
              updated_at: now,
            })
            .where('id', '=', params.task.id)
            .execute();

          this.logger.debug('computed:outbox:released_for_retry', {
            taskId: params.task.id,
            reason: params.reason,
            nextRunAt,
          });

          return ok({ released: true, taskId: params.task.id, availableAt: nextRunAt });
        },
        {
          logger: this.logger,
          operation: 'release_for_retry',
          logContext: { taskId: params.task.id, leaseOwner },
        }
      );
    };

    try {
      let result: Result<ReleaseOutcome, DomainError>;
      if (span && context?.tracer) {
        result = await context.tracer.withSpan(span, executeRelease);
      } else {
        result = await executeRelease();
      }
      if (result.isErr()) return err(result.error);
      if (result.value.released && result.value.taskId && result.value.availableAt) {
        await this.scheduleWakeup(
          {
            taskId: result.value.taskId,
            baseId: params.task.baseId,
            availableAt: result.value.availableAt,
            cause: 'retry',
          },
          context
        );
      }
      return ok(result.value.released);
    } finally {
      span?.end();
    }
  }

  async markFailed(
    task: AnyOutboxItem,
    error: string,
    context?: IExecutionContext,
    options: MarkFailedOptions = {}
  ): Promise<Result<boolean, DomainError>> {
    const failureSpanAttributes: Record<string, string | boolean> = {};
    if (options.failureKind) failureSpanAttributes['outbox.failure.kind'] = options.failureKind;
    if (options.failureReason) {
      failureSpanAttributes['outbox.failure.reason'] = options.failureReason;
    }
    if (options.retryable !== undefined) {
      failureSpanAttributes['outbox.failure.retryable'] = options.retryable;
    }
    if (options.directDeadLetter !== undefined) {
      failureSpanAttributes['outbox.deadLetter.direct'] = options.directDeadLetter;
    }

    const span = context?.tracer?.startSpan('teable.outbox.markFailed', {
      'outbox.taskId': task.id,
      'outbox.attempts': task.attempts,
      'outbox.maxAttempts': task.maxAttempts,
      ...failureSpanAttributes,
    });
    span?.recordError(error);

    const failureLogFields = buildFailureLogFields(task, options);

    type MarkFailedOutcome = { updated: boolean; retryAt?: Date };
    const executeMarkFailed = async (): Promise<Result<MarkFailedOutcome, DomainError>> => {
      const now = new Date();
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      const nextAttempts = task.attempts + 1;
      const leaseOwner = task.lockedBy ?? null;

      return runInTransaction<MarkFailedOutcome>(
        db,
        context,
        async (trx) => {
          if (leaseOwner) {
            const ownedRow = await trx
              .selectFrom(OUTBOX_TABLE)
              .select(['id'])
              .where('id', '=', task.id)
              .where('status', '=', 'processing')
              .where('locked_by', '=', leaseOwner)
              .forUpdate()
              .executeTakeFirst();

            if (!ownedRow) {
              this.logger.warn('computed:outbox:markFailed_skipped_owner_mismatch', {
                taskId: task.id,
                leaseOwner,
              });
              return ok({ updated: false });
            }
          }

          if (nextAttempts >= task.maxAttempts) {
            const isBackfill = isFieldBackfillItem(task);
            const isSeed = isSeedItem(task);

            // Build dead letter values based on task type
            const deadLetterValues = buildDeadLetterValues(task, {
              isBackfill,
              isSeed,
              nextAttempts,
              error,
              now,
            });

            await trx.insertInto(DEAD_LETTER_TABLE).values(deadLetterValues).execute();

            await trx.deleteFrom(OUTBOX_TABLE).where('id', '=', task.id).execute();
            await trx.deleteFrom(OUTBOX_SEED_TABLE).where('task_id', '=', task.id).execute();

            span?.setAttribute('outbox.deadLetter', true);
            this.logger.warn('computed:outbox:dead_letter', {
              taskId: task.id,
              error,
              attempts: nextAttempts,
              maxAttempts: task.maxAttempts,
              ...failureLogFields,
            });
            return ok({ updated: true });
          }

          const delay = Math.min(
            this.config.baseBackoffMs * 2 ** (nextAttempts - 1),
            this.config.maxBackoffMs
          );
          const nextRunAt = new Date(now.getTime() + delay);

          await trx
            .updateTable(OUTBOX_TABLE)
            .set({
              status: DEFAULT_STATUS,
              attempts: nextAttempts,
              next_run_at: nextRunAt,
              last_error: error,
              locked_at: null,
              locked_by: null,
              updated_at: now,
            })
            .where('id', '=', task.id)
            .execute();

          span?.setAttribute('outbox.retryScheduled', true);
          this.logger.warn('computed:outbox:retry_scheduled', {
            taskId: task.id,
            attempts: nextAttempts,
            nextRunAt,
            ...failureLogFields,
          });

          return ok({ updated: true, retryAt: nextRunAt });
        },
        {
          logger: this.logger,
          operation: 'mark_failed',
          logContext: { taskId: task.id, leaseOwner, attempts: task.attempts },
        }
      );
    };

    try {
      let result: Result<MarkFailedOutcome, DomainError>;
      if (span && context?.tracer) {
        result = await context.tracer.withSpan(span, executeMarkFailed);
      } else {
        result = await executeMarkFailed();
      }
      if (result.isErr()) return err(result.error);
      if (result.value.updated && result.value.retryAt) {
        await this.scheduleWakeup(
          {
            taskId: task.id,
            baseId: task.baseId,
            availableAt: result.value.retryAt,
            cause: 'retry',
          },
          context
        );
      }
      return ok(result.value.updated);
    } finally {
      span?.end();
    }
  }

  private async insertOutbox(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    task: ComputedUpdateOutboxTaskInput,
    now: Date
  ): Promise<string> {
    const seedAllTableIds = task.seedAllTableIds ?? [];
    const seedAllSet = new Set(seedAllTableIds);
    const seedGroups = buildSeedGroupsFromTask(task).filter((g) => !seedAllSet.has(g.tableId));
    const seedCount = countSeedRecords(seedGroups);
    const useSeedTable = seedCount > this.config.seedInlineLimit;

    const record = await trx
      .insertInto(OUTBOX_TABLE)
      .values({
        id: createOutboxId(),
        base_id: task.baseId,
        seed_table_id: task.seedTableId,
        seed_record_ids: useSeedTable ? null : toJsonValue(seedGroups),
        change_type: task.changeType,
        steps: toJsonValue(task.steps),
        edges: toJsonValue(task.edges),
        status: DEFAULT_STATUS,
        attempts: 0,
        max_attempts: this.config.maxAttempts,
        next_run_at: now,
        locked_at: null,
        locked_by: null,
        last_error: null,
        estimated_complexity: task.estimatedComplexity,
        plan_hash: task.planHash,
        dirty_stats: toJsonValue({
          dirtyStats: task.dirtyStats,
          beforeImageRecords: task.beforeImageRecords,
          seedAllTableIds: seedAllTableIds.length > 0 ? seedAllTableIds : undefined,
          orchestration: task.orchestration,
        }),
        run_id: task.runId,
        origin_run_ids: task.originRunIds,
        run_total_steps: task.runTotalSteps,
        run_completed_steps_before: task.runCompletedStepsBefore,
        affected_table_ids: task.affectedTableIds,
        affected_field_ids: task.affectedFieldIds,
        sync_max_level: task.syncMaxLevel,
        created_at: now,
        updated_at: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const taskId = String(record.id);

    if (useSeedTable) {
      await this.upsertSeedRows(trx, taskId, flattenSeedGroups(seedGroups));
    }

    return taskId;
  }

  private async mergeComputedTask(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    existing: OutboxRow,
    task: ComputedUpdateOutboxTaskInput,
    now: Date
  ): Promise<string> {
    const taskId = String(existing.id);
    const seedAllTableIds = mergeSeedAllTableIds(
      parseSeedAllTableIds(existing.dirty_stats),
      task.seedAllTableIds
    );
    const seedAllSet = new Set(seedAllTableIds ?? []);
    const incomingSeedGroups = buildSeedGroupsFromTask(task).filter(
      (g) => !seedAllSet.has(g.tableId)
    );
    const existingSeedGroups = (await this.loadSeedGroups(trx, existing)).filter(
      (g) => !seedAllSet.has(g.tableId)
    );
    const mergedSeedGroups = mergeSeedGroups(existingSeedGroups, incomingSeedGroups);
    const mergedDirtyStats = mergeDirtyStats(
      parseDirtyStats(existing.dirty_stats),
      task.dirtyStats
    );
    const mergedBeforeImageRecords = mergeBeforeImageRecordDtos(
      parseBeforeImageRecordDtos(existing.dirty_stats),
      task.beforeImageRecords
    );
    const mergedOrchestration = mergeComputedRealtimeOrchestration(
      parseRealtimeOrchestration(existing.dirty_stats),
      task.orchestration
    );
    const mergedOriginRunIds = mergeOriginRunIds(
      parseStringArray(existing.origin_run_ids),
      task.originRunIds
    );
    const existingRunId = existing.run_id ? String(existing.run_id) : null;
    const mergedRunId = existingRunId ?? task.runId;

    const seedInlineLimit = this.config.seedInlineLimit;
    const mergedSeedCount = countSeedRecords(mergedSeedGroups);
    const useSeedTable = mergedSeedCount > seedInlineLimit;

    if (useSeedTable) {
      await this.upsertSeedRows(trx, taskId, flattenSeedGroups(mergedSeedGroups));
    } else {
      await trx.deleteFrom(OUTBOX_SEED_TABLE).where('task_id', '=', taskId).execute();
    }

    await trx
      .updateTable(OUTBOX_TABLE)
      .set({
        seed_record_ids: useSeedTable ? null : toJsonValue(mergedSeedGroups),
        dirty_stats: toJsonValue({
          dirtyStats: mergedDirtyStats,
          beforeImageRecords: mergedBeforeImageRecords,
          seedAllTableIds:
            seedAllTableIds && seedAllTableIds.length > 0 ? seedAllTableIds : undefined,
          orchestration: mergedOrchestration,
        }),
        run_id: mergedRunId,
        origin_run_ids: mergedOriginRunIds,
        run_total_steps: Math.max(Number(existing.run_total_steps ?? 0), task.runTotalSteps),
        run_completed_steps_before: Math.max(
          Number(existing.run_completed_steps_before ?? 0),
          task.runCompletedStepsBefore
        ),
        estimated_complexity: Math.max(
          Number(existing.estimated_complexity ?? 0),
          task.estimatedComplexity
        ),
        sync_max_level: Math.max(Number(existing.sync_max_level ?? 0), task.syncMaxLevel),
        next_run_at: now,
        updated_at: now,
      })
      .where('id', '=', taskId)
      .execute();

    this.logger.debug('computed:outbox:merged', {
      taskId,
      seedCount: mergedSeedCount,
      runId: mergedRunId,
      originRunIds: mergedOriginRunIds,
    });

    return taskId;
  }

  private async mergeRetryTaskIntoPending(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    pending: OutboxRow,
    task: AnyOutboxItem,
    now: Date
  ): Promise<string> {
    if (isSeedOutboxItem(task)) {
      return this.mergeSeedTask(trx, pending, seedOutboxItemToTaskInput(task), now);
    }

    if (isFieldBackfillOutboxItem(task)) {
      return this.mergeFieldBackfillRetryTask(trx, pending, task, now);
    }

    return this.mergeComputedTask(trx, pending, computedOutboxItemToTaskInput(task), now);
  }

  private async mergeFieldBackfillRetryTask(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    existing: OutboxRow,
    task: FieldBackfillOutboxItem,
    now: Date
  ): Promise<string> {
    const taskId = String(existing.id);
    const mergedFieldIds = [
      ...new Set([...parseStringArray(existing.affected_field_ids), ...task.fieldIds]),
    ];

    await trx
      .updateTable(OUTBOX_TABLE)
      .set({
        affected_field_ids: mergedFieldIds,
        estimated_complexity: Math.max(
          Number(existing.estimated_complexity ?? 0),
          task.estimatedRowCount ?? 0
        ),
        next_run_at: now,
        updated_at: now,
      })
      .where('id', '=', taskId)
      .execute();

    return taskId;
  }

  private async deleteOwnedProcessingTask(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    taskId: string,
    leaseOwner: string | null
  ): Promise<boolean> {
    const query = trx
      .deleteFrom(OUTBOX_TABLE)
      .where('id', '=', taskId)
      .where('status', '=', 'processing');
    const deleted = await (leaseOwner ? query.where('locked_by', '=', leaseOwner) : query)
      .returning('id')
      .execute();

    if (deleted.length === 0) return false;

    await trx.deleteFrom(OUTBOX_SEED_TABLE).where('task_id', '=', taskId).execute();
    return true;
  }

  private async loadSeedGroups(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    existing: OutboxRow
  ): Promise<SeedGroup[]> {
    const inlineGroups = parseSeedGroups(existing.seed_record_ids, String(existing.seed_table_id));

    if (existing.seed_record_ids !== null) return inlineGroups;

    const storedGroups = await this.loadSeedRecordsForTask(trx, String(existing.id));
    return mergeSeedGroups(inlineGroups, storedGroups);
  }

  private async loadSeedRecords(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    rows: OutboxRow[]
  ): Promise<Map<string, SeedGroup[]>> {
    const needsSeed = rows
      .filter((row) => row.seed_record_ids === null)
      .map((row) => String(row.id));

    if (needsSeed.length === 0) return new Map();

    const seedRows = await trx
      .selectFrom(OUTBOX_SEED_TABLE)
      .select(['task_id', 'table_id', 'record_id'])
      .where('task_id', 'in', needsSeed)
      .execute();

    const map = new Map<string, SeedGroup[]>();
    for (const row of seedRows as SeedRow[]) {
      const groups = map.get(row.task_id) ?? [];
      map.set(row.task_id, groups);
      const group = groups.find((entry) => entry.tableId === row.table_id);
      if (group) {
        group.recordIds.push(row.record_id);
      } else {
        groups.push({ tableId: row.table_id, recordIds: [row.record_id] });
      }
    }
    return map;
  }

  private async loadSeedRecordsForTask(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    taskId: string
  ): Promise<SeedGroup[]> {
    const seedRows = await trx
      .selectFrom(OUTBOX_SEED_TABLE)
      .select(['task_id', 'table_id', 'record_id'])
      .where('task_id', '=', taskId)
      .execute();

    const groups: SeedGroup[] = [];
    for (const row of seedRows as SeedRow[]) {
      const group = groups.find((entry) => entry.tableId === row.table_id);
      if (group) {
        group.recordIds.push(row.record_id);
      } else {
        groups.push({ tableId: row.table_id, recordIds: [row.record_id] });
      }
    }
    return groups;
  }

  private async upsertSeedRows(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    taskId: string,
    seeds: SeedRecord[]
  ): Promise<void> {
    if (seeds.length === 0) return;

    const sortedSeeds = [...seeds].sort((left, right) => {
      const tableOrder = left.tableId.localeCompare(right.tableId);
      if (tableOrder !== 0) return tableOrder;
      return left.recordId.localeCompare(right.recordId);
    });

    const rows = sortedSeeds.map((record) => ({
      id: createOutboxSeedId(),
      task_id: taskId,
      table_id: record.tableId,
      record_id: record.recordId,
    }));

    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      await trx
        .insertInto(OUTBOX_SEED_TABLE)
        .values(rows.slice(i, i + batchSize))
        .onConflict((oc) => oc.columns(['task_id', 'table_id', 'record_id']).doNothing())
        .execute();
    }
  }

  private async insertFieldBackfill(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    task: FieldBackfillOutboxTaskInput,
    now: Date
  ): Promise<string> {
    const record = await trx
      .insertInto(OUTBOX_TABLE)
      .values({
        id: createOutboxId(),
        base_id: task.baseId,
        seed_table_id: task.tableId,
        seed_record_ids: null,
        change_type: FIELD_BACKFILL_CHANGE_TYPE,
        steps: toJsonValue([]),
        edges: toJsonValue([]),
        status: DEFAULT_STATUS,
        attempts: 0,
        max_attempts: this.config.maxAttempts,
        next_run_at: now,
        locked_at: null,
        locked_by: null,
        last_error: null,
        estimated_complexity: task.estimatedRowCount ?? 0,
        plan_hash: task.planHash,
        dirty_stats: null,
        run_id: task.runId,
        origin_run_ids: [],
        run_total_steps: 1,
        run_completed_steps_before: 0,
        affected_table_ids: [task.tableId],
        affected_field_ids: task.fieldIds,
        sync_max_level: 0,
        created_at: now,
        updated_at: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const taskId = String(record.id);

    this.logger.debug('computed:outbox:field_backfill_created', {
      taskId,
      tableId: task.tableId,
      fieldIds: task.fieldIds,
      runId: task.runId,
    });

    return taskId;
  }

  private async findPendingSeedTask(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    task: ComputedUpdateSeedTaskInput
  ): Promise<OutboxRow | undefined> {
    return await trx
      .selectFrom(OUTBOX_TABLE)
      .selectAll()
      .where('base_id', '=', task.baseId)
      .where('seed_table_id', '=', task.seedTableId)
      .where('plan_hash', '=', task.planHash)
      .where('change_type', '=', SEED_CHANGE_TYPE)
      .where('status', '=', DEFAULT_STATUS)
      .forUpdate()
      .executeTakeFirst();
  }

  private async mergeSeedTask(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    existing: OutboxRow,
    task: ComputedUpdateSeedTaskInput,
    now: Date
  ): Promise<string> {
    const taskId = String(existing.id);
    const existingPayload = parseSeedPayloadFromRow(existing);
    const mergedPayload = mergeSeedPayloads(existingPayload, task);
    const mergedSeedGroups = buildSeedGroupsFromSeedPayload(mergedPayload);
    const mergedSeedCount = countSeedRecords(mergedSeedGroups);
    const useSeedTable = mergedSeedCount > this.config.seedInlineLimit;

    if (useSeedTable) {
      await this.upsertSeedRows(trx, taskId, flattenSeedGroups(mergedSeedGroups));
    } else {
      await trx.deleteFrom(OUTBOX_SEED_TABLE).where('task_id', '=', taskId).execute();
    }

    await trx
      .updateTable(OUTBOX_TABLE)
      .set({
        seed_record_ids: useSeedTable ? null : toJsonValue(mergedSeedGroups),
        affected_field_ids: mergedPayload.changedFieldIds,
        dirty_stats: toJsonValue({
          changeType: mergedPayload.changeType,
          impact: mergedPayload.impact ?? null,
          beforeImageRecords: mergedPayload.beforeImageRecords,
          orchestration: mergedPayload.orchestration,
        }),
        next_run_at: now,
        updated_at: now,
      })
      .where('id', '=', taskId)
      .execute();

    this.logger.debug('computed:outbox:seed_merged', {
      taskId,
      seedCount: mergedSeedCount,
      changedFieldIds: mergedPayload.changedFieldIds,
    });

    return taskId;
  }

  private async insertSeedTask(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    task: ComputedUpdateSeedTaskInput,
    now: Date
  ): Promise<string | null> {
    const seedGroups = buildSeedGroupsFromSeedPayload(task);
    const seedCount = countSeedRecords(seedGroups);
    const useSeedTable = seedCount > this.config.seedInlineLimit;
    const values = {
      id: createOutboxId(),
      base_id: task.baseId,
      seed_table_id: task.seedTableId,
      seed_record_ids: useSeedTable ? null : toJsonValue(seedGroups),
      change_type: SEED_CHANGE_TYPE,
      steps: toJsonValue([]), // Seed tasks don't have pre-computed steps
      edges: toJsonValue([]), // Seed tasks don't have pre-computed edges
      status: DEFAULT_STATUS,
      attempts: 0,
      max_attempts: this.config.maxAttempts,
      next_run_at: now,
      locked_at: null,
      locked_by: null,
      last_error: null,
      estimated_complexity: seedCount,
      plan_hash: task.planHash,
      // Store seed meta in dirty_stats column (repurposed for seed tasks).
      // This preserves the real changeType ('insert' | 'update' | 'delete') which is
      // required by the planner (e.g. delete optimizations).
      dirty_stats: toJsonValue({
        changeType: task.changeType,
        impact: task.impact ?? null,
        beforeImageRecords: task.beforeImageRecords,
        orchestration: task.orchestration,
      }),
      run_id: task.runId,
      origin_run_ids: [],
      run_total_steps: 0, // Will be computed by worker
      run_completed_steps_before: 0,
      affected_table_ids: [task.seedTableId],
      affected_field_ids: task.changedFieldIds,
      sync_max_level: 0,
      created_at: now,
      updated_at: now,
    };

    const record = (await this.hasPendingSeedUniqueIndex(trx))
      ? await trx
          .insertInto(OUTBOX_TABLE)
          .values(values)
          .onConflict((oc) =>
            oc
              .columns(['base_id', 'seed_table_id', 'plan_hash', 'change_type'])
              .where('status', '=', DEFAULT_STATUS)
              .doNothing()
          )
          .returning('id')
          .executeTakeFirst()
      : await trx.insertInto(OUTBOX_TABLE).values(values).returning('id').executeTakeFirstOrThrow();

    if (!record) {
      this.logger.debug('computed:outbox:seed_insert_conflicted', {
        baseId: task.baseId,
        seedTableId: task.seedTableId,
        changedFieldIds: task.changedFieldIds,
        runId: task.runId,
      });
      return null;
    }

    const taskId = String(record.id);

    if (useSeedTable) {
      await this.upsertSeedRows(trx, taskId, flattenSeedGroups(seedGroups));
    }

    this.logger.debug('computed:outbox:seed_created', {
      taskId,
      baseId: task.baseId,
      seedTableId: task.seedTableId,
      seedCount,
      changedFieldIds: task.changedFieldIds,
      runId: task.runId,
    });

    return taskId;
  }

  private async hasPendingSeedUniqueIndex(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>
  ): Promise<boolean> {
    if (typeof this.pendingSeedUniqueIndexAvailable === 'boolean') {
      return this.pendingSeedUniqueIndexAvailable;
    }

    try {
      const result = await sql<{ exists: boolean }>`
        select exists (
          select 1
          from pg_indexes
          where schemaname = current_schema()
            and indexname = ${PENDING_SEED_UNIQUE_INDEX}
        ) as "exists"
      `.execute(trx);
      const exists = Boolean(result.rows[0]?.exists);
      this.pendingSeedUniqueIndexAvailable = exists;
      return exists;
    } catch (error) {
      this.logger.debug('computed:outbox:pending_seed_unique_index_probe_failed', {
        error: toErrorLogFields(error),
      });
      this.pendingSeedUniqueIndexAvailable = false;
      return false;
    }
  }
}

const toOutboxItem = (
  row: OutboxRow,
  seedGroupsFromTable: SeedGroup[]
): ComputedUpdateOutboxItem => {
  const seedTableId = String(row.seed_table_id);
  const inlineSeedGroups = parseSeedGroups(row.seed_record_ids, seedTableId);
  const seedGroups = mergeSeedGroups(inlineSeedGroups, seedGroupsFromTable);
  const { seedRecordIds, extraSeedRecords } = splitSeedGroups(seedTableId, seedGroups);

  return {
    id: String(row.id),
    baseId: String(row.base_id),
    seedTableId,
    seedRecordIds,
    extraSeedRecords,
    beforeImageRecords: parseBeforeImageRecordDtos(row.dirty_stats),
    steps: parseJsonArray(row.steps) ?? [],
    edges: parseJsonArray(row.edges) ?? [],
    estimatedComplexity: Number(row.estimated_complexity ?? 0),
    changeType: String(row.change_type) as ComputedUpdateOutboxItem['changeType'],
    planHash: String(row.plan_hash),
    dirtyStats: parseDirtyStats(row.dirty_stats),
    seedAllTableIds: parseSeedAllTableIds(row.dirty_stats),
    orchestration: parseRealtimeOrchestration(row.dirty_stats),
    runId: String(row.run_id ?? ''),
    originRunIds: parseStringArray(row.origin_run_ids),
    runTotalSteps: Number(row.run_total_steps ?? 0),
    runCompletedStepsBefore: Number(row.run_completed_steps_before ?? 0),
    affectedTableIds: parseStringArray(row.affected_table_ids),
    affectedFieldIds: parseStringArray(row.affected_field_ids),
    syncMaxLevel: Number(row.sync_max_level ?? 0),
    status: String(row.status) as ComputedUpdateOutboxItem['status'],
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 0),
    nextRunAt: new Date(String(row.next_run_at)),
    lockedAt: row.locked_at ? new Date(String(row.locked_at)) : null,
    lockedBy: row.locked_by ? String(row.locked_by) : null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
};

const parseJsonValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const parseJsonArray = <T>(value: unknown): T[] | undefined => {
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) return parsed as T[];
  return undefined;
};

const toJsonValue = (value: unknown): unknown => {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [];
};

const parseDirtyStats = (value: unknown): ReadonlyArray<DirtyRecordStats> | undefined => {
  const parsed = parseJsonValue(value);
  // Rolling upgrade compatibility: older rows store dirty_stats as the raw stats array,
  // while newer rows store an object with { dirtyStats, beforeImageRecords }.
  const rawStats =
    Array.isArray(parsed) || parsed == null || typeof parsed !== 'object'
      ? parsed
      : (parsed as { dirtyStats?: unknown }).dirtyStats;
  if (!Array.isArray(rawStats)) return undefined;
  return rawStats
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as { tableId?: unknown; recordCount?: unknown };
      if (typeof entry.tableId !== 'string') return null;
      return {
        tableId: entry.tableId,
        recordCount: Number(entry.recordCount ?? 0),
      };
    })
    .filter((item): item is DirtyRecordStats => item !== null);
};

const parseBeforeImageRecordDtos = (
  value: unknown
): ComputedUpdateOutboxItem['beforeImageRecords'] => {
  const parsed = parseJsonValue(value);
  // Rolling upgrade compatibility: old rows have no before-image payload, so raw array
  // dirty_stats should decode to [] here instead of being treated as malformed data.
  const rawRecords =
    Array.isArray(parsed) || parsed == null || typeof parsed !== 'object'
      ? parsed
      : (parsed as { beforeImageRecords?: unknown }).beforeImageRecords;
  if (!Array.isArray(rawRecords)) return [];

  return rawRecords
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as { recordId?: unknown; fieldValuesByDbName?: unknown };
      if (typeof record.recordId !== 'string') return null;
      if (!record.fieldValuesByDbName || typeof record.fieldValuesByDbName !== 'object') {
        return null;
      }
      return {
        recordId: record.recordId,
        fieldValuesByDbName: { ...(record.fieldValuesByDbName as Record<string, unknown>) },
      };
    })
    .filter(
      (item): item is ComputedUpdateOutboxItem['beforeImageRecords'][number] => item !== null
    );
};

const parseSeedAllTableIds = (value: unknown): string[] | undefined => {
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed) || parsed == null || typeof parsed !== 'object') return undefined;
  const raw = (parsed as { seedAllTableIds?: unknown }).seedAllTableIds;
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((item): item is string => typeof item === 'string');
};

const parseRealtimeOrchestration = (
  value: unknown
): ComputedRealtimeOrchestrationDto | undefined => {
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed) || parsed == null || typeof parsed !== 'object') return undefined;
  const raw = (parsed as { orchestration?: unknown }).orchestration;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const orchestration = raw as {
    operationId?: unknown;
    groupId?: unknown;
    totalRecordCount?: unknown;
    totalChunkCount?: unknown;
    chunkIndex?: unknown;
    scope?: unknown;
  };

  if (
    typeof orchestration.totalRecordCount !== 'number' ||
    typeof orchestration.totalChunkCount !== 'number' ||
    typeof orchestration.chunkIndex !== 'number' ||
    (orchestration.scope !== 'operation' && orchestration.scope !== 'chunk')
  ) {
    return undefined;
  }

  return {
    ...(typeof orchestration.operationId === 'string'
      ? { operationId: orchestration.operationId }
      : {}),
    ...(typeof orchestration.groupId === 'string' ? { groupId: orchestration.groupId } : {}),
    totalRecordCount: orchestration.totalRecordCount,
    totalChunkCount: orchestration.totalChunkCount,
    chunkIndex: orchestration.chunkIndex,
    scope: orchestration.scope,
  };
};

const parseSeedGroups = (value: unknown, seedTableId: string): SeedGroup[] => {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) return [];

  const groups = new Map<string, Set<string>>();

  for (const item of parsed) {
    if (typeof item === 'string') {
      const set = groups.get(seedTableId) ?? new Set<string>();
      set.add(item);
      groups.set(seedTableId, set);
      continue;
    }

    if (!item || typeof item !== 'object') continue;

    const recordId = (item as { recordId?: unknown }).recordId;
    const recordIds = (item as { recordIds?: unknown }).recordIds;
    const tableId = String((item as { tableId?: unknown }).tableId ?? seedTableId);

    if (Array.isArray(recordIds)) {
      const set = groups.get(tableId) ?? new Set<string>();
      for (const id of recordIds) {
        set.add(String(id));
      }
      groups.set(tableId, set);
      continue;
    }

    if (recordId !== undefined && recordId !== null) {
      const set = groups.get(tableId) ?? new Set<string>();
      set.add(String(recordId));
      groups.set(tableId, set);
    }
  }

  return [...groups.entries()].map(([tableId, recordIds]) => ({
    tableId,
    recordIds: [...recordIds],
  }));
};

const mergeSeedGroups = (...groups: SeedGroup[][]): SeedGroup[] => {
  const merged = new Map<string, Set<string>>();

  for (const groupList of groups) {
    for (const group of groupList) {
      if (!group || group.recordIds.length === 0) continue;
      const set = merged.get(group.tableId) ?? new Set<string>();
      for (const recordId of group.recordIds) {
        set.add(recordId);
      }
      merged.set(group.tableId, set);
    }
  }

  return [...merged.entries()].map(([tableId, recordIds]) => ({
    tableId,
    recordIds: [...recordIds],
  }));
};

const splitSeedGroups = (
  seedTableId: string,
  groups: SeedGroup[]
): { seedRecordIds: string[]; extraSeedRecords: SeedGroup[] } => {
  const seedRecordIds: string[] = [];
  const extraSeedRecords: SeedGroup[] = [];

  for (const group of groups) {
    if (group.tableId === seedTableId) {
      for (const id of group.recordIds) seedRecordIds.push(id);
    } else {
      extraSeedRecords.push(group);
    }
  }

  return { seedRecordIds, extraSeedRecords };
};

const buildSeedGroupsFromTask = (task: ComputedUpdateOutboxTaskInput): SeedGroup[] => {
  const baseGroup: SeedGroup = {
    tableId: task.seedTableId,
    recordIds: task.seedRecordIds,
  };

  return mergeSeedGroups([baseGroup], task.extraSeedRecords ?? []);
};

const getOutboxRowSeedTableId = (task: AnyOutboxItem): string =>
  isFieldBackfillOutboxItem(task) ? task.tableId : task.seedTableId;

const getOutboxRowChangeType = (task: AnyOutboxItem): string => {
  if (isFieldBackfillOutboxItem(task)) return FIELD_BACKFILL_CHANGE_TYPE;
  if (isSeedOutboxItem(task)) return SEED_CHANGE_TYPE;
  return task.changeType;
};

const computedOutboxItemToTaskInput = (
  task: ComputedUpdateOutboxItem
): ComputedUpdateOutboxTaskInput => ({
  baseId: task.baseId,
  seedTableId: task.seedTableId,
  seedRecordIds: task.seedRecordIds,
  extraSeedRecords: task.extraSeedRecords,
  beforeImageRecords: task.beforeImageRecords,
  steps: task.steps,
  edges: task.edges,
  estimatedComplexity: task.estimatedComplexity,
  changeType: task.changeType,
  runId: task.runId,
  originRunIds: task.originRunIds,
  runTotalSteps: task.runTotalSteps,
  runCompletedStepsBefore: task.runCompletedStepsBefore,
  stageDepth: task.stageDepth,
  orchestration: task.orchestration,
  planHash: task.planHash,
  dirtyStats: task.dirtyStats,
  affectedTableIds: task.affectedTableIds,
  affectedFieldIds: task.affectedFieldIds,
  syncMaxLevel: task.syncMaxLevel,
});

const seedOutboxItemToTaskInput = (task: SeedOutboxItem): ComputedUpdateSeedTaskInput => ({
  taskType: 'seed',
  baseId: task.baseId,
  seedTableId: task.seedTableId,
  seedRecordIds: task.seedRecordIds,
  extraSeedRecords: task.extraSeedRecords,
  beforeImageRecords: task.beforeImageRecords,
  changedFieldIds: task.changedFieldIds,
  changeType: task.changeType,
  impact: task.impact,
  orchestration: task.orchestration,
  runId: task.runId,
  planHash: task.planHash,
});

const mergeSeedAllTableIds = (
  existing: string[] | undefined,
  incoming: string[] | undefined
): string[] | undefined => {
  if (!existing?.length && !incoming?.length) return undefined;
  const set = new Set<string>();
  for (const id of existing ?? []) set.add(id);
  for (const id of incoming ?? []) set.add(id);
  return Array.from(set);
};

const flattenSeedGroups = (groups: SeedGroup[]): SeedRecord[] => {
  const seeds: SeedRecord[] = [];
  for (const group of groups) {
    for (const recordId of group.recordIds) {
      seeds.push({ tableId: group.tableId, recordId });
    }
  }
  return seeds;
};

const countSeedRecords = (groups: SeedGroup[]): number => {
  return groups.reduce((sum, group) => sum + group.recordIds.length, 0);
};

const mergeDirtyStats = (
  existing: ReadonlyArray<DirtyRecordStats> | undefined,
  incoming: ReadonlyArray<DirtyRecordStats> | undefined
): ReadonlyArray<DirtyRecordStats> | undefined => {
  if (!existing && !incoming) return undefined;
  const map = new Map<string, number>();
  for (const stat of existing ?? []) {
    map.set(stat.tableId, (map.get(stat.tableId) ?? 0) + stat.recordCount);
  }
  for (const stat of incoming ?? []) {
    map.set(stat.tableId, (map.get(stat.tableId) ?? 0) + stat.recordCount);
  }
  return [...map.entries()].map(([tableId, recordCount]) => ({ tableId, recordCount }));
};

const mergeOriginRunIds = (existing: string[], incoming: string[]): string[] => {
  const merged = new Set<string>();
  for (const id of existing) merged.add(id);
  for (const id of incoming) merged.add(id);
  return [...merged];
};

class OutboxAbort extends Error {
  constructor(readonly error: DomainError) {
    super(error.message);
    this.name = 'OutboxAbort';
  }
}

const OUTBOX_TX_MAX_RETRIES = 10;

const runInTransaction = async <T>(
  db: Kysely<DynamicDB>,
  context: IExecutionContext | undefined,
  fn: (trx: Kysely<DynamicDB> | Transaction<DynamicDB>) => Promise<Result<T, DomainError>>,
  options?: RunInTransactionOptions
): Promise<Result<T, DomainError>> => {
  const hasTransaction = Boolean(getPostgresTransaction(context));
  let attempt = 0;
  let lastUnexpectedError: unknown;

  while (!hasTransaction || attempt === 0) {
    try {
      if (hasTransaction) {
        const result = await fn(db as Transaction<DynamicDB>);
        if (result.isErr()) throw new OutboxAbort(result.error);
        return result;
      }

      return await db.transaction().execute(async (trx) => {
        const result = await fn(trx);
        if (result.isErr()) throw new OutboxAbort(result.error);
        return result;
      });
    } catch (error) {
      if (error instanceof OutboxAbort) return err(error.error);
      const retryable =
        !hasTransaction && isRetryableTransactionError(error) && attempt < OUTBOX_TX_MAX_RETRIES;
      if (retryable) {
        const delayMs = backoffMs(attempt);
        attempt += 1;
        await sleep(delayMs);
        continue;
      }
      options?.logger?.error('computed:outbox:transaction_unexpected_error', {
        operation: options?.operation,
        hasTransaction,
        attempt,
        ...options?.logContext,
        ...toErrorLogFields(error),
      });
      lastUnexpectedError = error;
      break;
    }
  }

  return err(
    domainError.infrastructure({
      message: `Outbox transaction failed: ${describeError(lastUnexpectedError)}`,
    })
  );
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

const backoffMs = (attempt: number): number => {
  const base = 5 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 10);
  return base + jitter;
};

const isRetryableTransactionError = (error: unknown): boolean => {
  const message = describeError(error).toLowerCase();
  const isOutboxUniqueViolation =
    (message.includes('duplicate key value') || message.includes('unique constraint failed')) &&
    message.includes('computed_update_outbox');
  return (
    isOutboxUniqueViolation ||
    message.includes('current transaction is aborted') ||
    message.includes('deadlock') ||
    message.includes('could not serialize access') ||
    message.includes('serialization failure')
  );
};

const buildOutboxLockKey = (params: {
  baseId: string;
  seedTableId: string;
  planHash: string;
  changeType: string;
}): string =>
  `v2:outbox:${params.baseId}:${params.seedTableId}:${params.planHash}:${params.changeType}`;

const acquireOutboxAdvisoryLock = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  key: string
): Promise<void> => {
  await db.executeQuery(
    sql`SELECT pg_advisory_xact_lock(('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint)`.compile(
      db
    )
  );
};

const tryAcquireOutboxAdvisoryLock = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  key: string
): Promise<boolean> => {
  const result = await db.executeQuery(buildTryAdvisoryLockQuery(db, key));
  return result.rows[0]?.locked === true;
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};

/**
 * Convert a database row to the appropriate outbox item type based on change_type.
 */
const toAnyOutboxItem = (row: OutboxRow, seedGroupsFromTable: SeedGroup[]): AnyOutboxItem => {
  const changeType = String(row.change_type);

  if (changeType === FIELD_BACKFILL_CHANGE_TYPE) {
    return toFieldBackfillOutboxItem(row);
  }

  if (changeType === SEED_CHANGE_TYPE) {
    return toSeedOutboxItem(row, seedGroupsFromTable);
  }

  return toOutboxItem(row, seedGroupsFromTable);
};

/**
 * Convert a database row to a FieldBackfillOutboxItem.
 */
const toFieldBackfillOutboxItem = (row: OutboxRow): FieldBackfillOutboxItem => {
  return {
    taskType: 'field-backfill',
    id: String(row.id),
    baseId: String(row.base_id),
    tableId: String(row.seed_table_id),
    fieldIds: parseStringArray(row.affected_field_ids),
    estimatedRowCount: Number(row.estimated_complexity ?? 0),
    runId: String(row.run_id ?? ''),
    planHash: String(row.plan_hash),
    status: String(row.status) as FieldBackfillOutboxItem['status'],
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 0),
    nextRunAt: new Date(String(row.next_run_at)),
    lockedAt: row.locked_at ? new Date(String(row.locked_at)) : null,
    lockedBy: row.locked_by ? String(row.locked_by) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
};

/**
 * Check if an outbox item is a field backfill task.
 */
const isFieldBackfillItem = (task: AnyOutboxItem): task is FieldBackfillOutboxItem => {
  return (task as FieldBackfillOutboxItem).taskType === 'field-backfill';
};

/**
 * Convert a database row to a SeedOutboxItem.
 */
const toSeedOutboxItem = (row: OutboxRow, seedGroupsFromTable: SeedGroup[]): SeedOutboxItem => {
  const seedTableId = String(row.seed_table_id);
  const inlineSeedGroups = parseSeedGroups(row.seed_record_ids, seedTableId);
  const seedGroups = mergeSeedGroups(inlineSeedGroups, seedGroupsFromTable);
  const { seedRecordIds, extraSeedRecords } = splitSeedGroups(seedTableId, seedGroups);

  // Parse seed meta from dirty_stats column (repurposed for seed tasks)
  const impact = parseSeedImpact(row.dirty_stats);
  const changeType = parseSeedChangeType(row.dirty_stats) ?? 'update';

  return {
    taskType: 'seed',
    id: String(row.id),
    baseId: String(row.base_id),
    seedTableId,
    seedRecordIds,
    extraSeedRecords,
    beforeImageRecords: parseBeforeImageRecordDtos(row.dirty_stats),
    changedFieldIds: parseStringArray(row.affected_field_ids),
    changeType,
    impact,
    orchestration: parseRealtimeOrchestration(row.dirty_stats),
    runId: String(row.run_id ?? ''),
    planHash: String(row.plan_hash),
    status: String(row.status) as SeedOutboxItem['status'],
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 0),
    nextRunAt: new Date(String(row.next_run_at)),
    lockedAt: row.locked_at ? new Date(String(row.locked_at)) : null,
    lockedBy: row.locked_by ? String(row.locked_by) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
};

/**
 * Parse seed payload from database row for merging.
 */
const parseSeedPayloadFromRow = (row: OutboxRow): ComputedUpdateSeedTaskInput => {
  const seedTableId = String(row.seed_table_id);
  const inlineSeedGroups = parseSeedGroups(row.seed_record_ids, seedTableId);
  const { seedRecordIds, extraSeedRecords } = splitSeedGroups(seedTableId, inlineSeedGroups);

  return {
    taskType: 'seed',
    baseId: String(row.base_id),
    seedTableId,
    seedRecordIds,
    extraSeedRecords,
    beforeImageRecords: parseBeforeImageRecordDtos(row.dirty_stats),
    changedFieldIds: parseStringArray(row.affected_field_ids),
    changeType: parseSeedChangeType(row.dirty_stats) ?? 'update',
    impact: parseSeedImpact(row.dirty_stats),
    orchestration: parseRealtimeOrchestration(row.dirty_stats),
    runId: String(row.run_id ?? ''),
    planHash: String(row.plan_hash),
  };
};

/**
 * Parse seed impact from dirty_stats column.
 */
const parseSeedImpact = (
  value: unknown
): { valueFieldIds: string[]; linkFieldIds: string[] } | undefined => {
  const parsed = parseJsonValue(value);
  if (!parsed || typeof parsed !== 'object') return undefined;
  // New format: { changeType, impact: { valueFieldIds, linkFieldIds } }
  // Old format: { valueFieldIds, linkFieldIds }
  const meta = parsed as { impact?: unknown };
  const inner = meta.impact && typeof meta.impact === 'object' ? meta.impact : parsed;
  const impact = inner as { valueFieldIds?: unknown; linkFieldIds?: unknown };
  if (!Array.isArray(impact.valueFieldIds) && !Array.isArray(impact.linkFieldIds)) return undefined;
  return {
    valueFieldIds: Array.isArray(impact.valueFieldIds)
      ? impact.valueFieldIds.map((id) => String(id))
      : [],
    linkFieldIds: Array.isArray(impact.linkFieldIds)
      ? impact.linkFieldIds.map((id) => String(id))
      : [],
  };
};

const parseSeedChangeType = (value: unknown): 'insert' | 'update' | 'delete' | undefined => {
  const parsed = parseJsonValue(value);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const meta = parsed as { changeType?: unknown };
  const changeType = meta.changeType;
  if (changeType === 'insert' || changeType === 'update' || changeType === 'delete') {
    return changeType;
  }
  return undefined;
};

/**
 * Build seed groups from seed payload.
 */
const buildSeedGroupsFromSeedPayload = (
  task:
    | ComputedUpdateSeedTaskInput
    | { seedTableId: string; seedRecordIds: string[]; extraSeedRecords: SeedGroup[] }
): SeedGroup[] => {
  const baseGroup: SeedGroup = {
    tableId: task.seedTableId,
    recordIds: task.seedRecordIds,
  };

  return mergeSeedGroups([baseGroup], task.extraSeedRecords ?? []);
};

/**
 * Check if an outbox item is a seed task.
 */
const isSeedItem = (task: AnyOutboxItem): task is SeedOutboxItem => {
  return (task as SeedOutboxItem).taskType === 'seed';
};

const buildFailureLogFields = (
  task: AnyOutboxItem,
  options: MarkFailedOptions
): Record<string, unknown> => ({
  baseId: task.baseId,
  seedTableId: 'seedTableId' in task ? task.seedTableId : null,
  tableId: 'tableId' in task ? task.tableId : null,
  taskType: isFieldBackfillItem(task) ? 'field-backfill' : isSeedItem(task) ? 'seed' : 'computed',
  ...(options.failureKind ? { failureKind: options.failureKind } : {}),
  ...(options.failureReason ? { failureReason: options.failureReason } : {}),
  ...(options.retryable !== undefined ? { retryable: options.retryable } : {}),
  ...(options.directDeadLetter !== undefined ? { directDeadLetter: options.directDeadLetter } : {}),
});

/**
 * Build dead letter table values based on task type.
 */
const buildDeadLetterValues = (
  task: AnyOutboxItem,
  params: {
    isBackfill: boolean;
    isSeed: boolean;
    nextAttempts: number;
    error: string;
    now: Date;
  }
): Record<string, unknown> => {
  const { isBackfill, isSeed, nextAttempts, error, now } = params;

  // Common fields for all task types
  const common = {
    id: task.id,
    base_id: task.baseId,
    status: 'dead',
    attempts: nextAttempts,
    max_attempts: task.maxAttempts,
    next_run_at: task.nextRunAt,
    locked_at: task.lockedAt ?? null,
    locked_by: task.lockedBy ?? null,
    last_error: error,
    plan_hash: task.planHash,
    run_id: task.runId,
    failed_at: now,
    created_at: task.createdAt,
    updated_at: now,
  };

  if (isBackfill) {
    const backfillTask = task as FieldBackfillOutboxItem;
    return {
      ...common,
      seed_table_id: backfillTask.tableId,
      seed_record_ids: null,
      change_type: FIELD_BACKFILL_CHANGE_TYPE,
      steps: toJsonValue([]),
      edges: toJsonValue([]),
      estimated_complexity: backfillTask.estimatedRowCount ?? 0,
      dirty_stats: null,
      origin_run_ids: [],
      run_total_steps: 1,
      run_completed_steps_before: 0,
      affected_table_ids: [backfillTask.tableId],
      affected_field_ids: backfillTask.fieldIds,
      sync_max_level: 0,
    };
  }

  if (isSeed) {
    const seedTask = task as SeedOutboxItem;
    return {
      ...common,
      seed_table_id: seedTask.seedTableId,
      seed_record_ids: toJsonValue(buildSeedGroupsFromSeedPayload(seedTask)),
      change_type: SEED_CHANGE_TYPE,
      steps: toJsonValue([]),
      edges: toJsonValue([]),
      estimated_complexity: seedTask.seedRecordIds.length,
      dirty_stats: toJsonValue({
        changeType: seedTask.changeType,
        impact: seedTask.impact ?? null,
        beforeImageRecords: seedTask.beforeImageRecords,
        orchestration: seedTask.orchestration,
      }),
      origin_run_ids: [],
      run_total_steps: 0,
      run_completed_steps_before: 0,
      affected_table_ids: [seedTask.seedTableId],
      affected_field_ids: seedTask.changedFieldIds,
      sync_max_level: 0,
    };
  }

  // ComputedUpdateOutboxItem
  const computedTask = task as ComputedUpdateOutboxItem;
  return {
    ...common,
    seed_table_id: computedTask.seedTableId,
    seed_record_ids: toJsonValue(buildSeedGroupsFromTask(computedTask)),
    change_type: computedTask.changeType,
    steps: toJsonValue(computedTask.steps),
    edges: toJsonValue(computedTask.edges),
    estimated_complexity: computedTask.estimatedComplexity,
    dirty_stats: toJsonValue({
      dirtyStats: computedTask.dirtyStats,
      beforeImageRecords: computedTask.beforeImageRecords,
      orchestration: computedTask.orchestration,
    }),
    origin_run_ids: computedTask.originRunIds,
    run_total_steps: computedTask.runTotalSteps,
    run_completed_steps_before: computedTask.runCompletedStepsBefore,
    affected_table_ids: computedTask.affectedTableIds,
    affected_field_ids: computedTask.affectedFieldIds,
    sync_max_level: computedTask.syncMaxLevel,
  };
};
