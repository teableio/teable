import {
  domainError,
  type DomainError,
  generatePrefixedId,
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
import type {
  ComputedUpdateOutboxItem,
  ComputedUpdateOutboxTaskInput,
} from './ComputedUpdateOutboxPayload';
import type { ComputedUpdateSeedTaskInput } from './ComputedUpdateSeedPayload';
import { mergeSeedPayloads } from './ComputedUpdateSeedPayload';
import type { FieldBackfillOutboxTaskInput } from './FieldBackfillOutboxPayload';
import { defaultComputedUpdateOutboxConfig } from './IComputedUpdateOutbox';
import type {
  IComputedUpdateOutbox,
  ClaimBatchParams,
  ComputedUpdateOutboxConfig,
  AnyOutboxItem,
  FieldBackfillOutboxItem,
  SeedOutboxItem,
} from './IComputedUpdateOutbox';

const OUTBOX_TABLE = 'computed_update_outbox';
const OUTBOX_SEED_TABLE = 'computed_update_outbox_seed';
const DEAD_LETTER_TABLE = 'computed_update_dead_letter';

const DEFAULT_STATUS = 'pending';
const OUTBOX_ID_PREFIX = 'cuo';
const OUTBOX_ID_BODY_LENGTH = 16;
const OUTBOX_SEED_ID_PREFIX = 'cus';
const OUTBOX_SEED_ID_BODY_LENGTH = 16;

/** Change type for field backfill tasks (stored in change_type column) */
const FIELD_BACKFILL_CHANGE_TYPE = 'field-backfill';

/** Change type for seed tasks (stored in change_type column) */
const SEED_CHANGE_TYPE = 'seed';

const createOutboxId = (): string => generatePrefixedId(OUTBOX_ID_PREFIX, OUTBOX_ID_BODY_LENGTH);
const createOutboxSeedId = (): string =>
  generatePrefixedId(OUTBOX_SEED_ID_PREFIX, OUTBOX_SEED_ID_BODY_LENGTH);

type OutboxRow = Record<string, unknown>;

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
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig)
    private readonly config: ComputedUpdateOutboxConfig = defaultComputedUpdateOutboxConfig,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger
  ) {}

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
      const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

      return runInTransaction<{ taskId: string; merged: boolean }>(db, context, async (trx) => {
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

        const taskId = String(existing.id);
        const incomingSeedGroups = buildSeedGroupsFromTask(task);
        const existingSeedGroups = await this.loadSeedGroups(trx, existing);
        const mergedSeedGroups = mergeSeedGroups(existingSeedGroups, incomingSeedGroups);
        const mergedDirtyStats = mergeDirtyStats(
          parseDirtyStats(existing.dirty_stats),
          task.dirtyStats
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
            dirty_stats: toJsonValue(mergedDirtyStats),
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

        return ok({ taskId, merged: true });
      });
    };

    try {
      if (span && context?.tracer) {
        return await context.tracer.withSpan(span, executeEnqueue);
      }
      return await executeEnqueue();
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
      const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

      return runInTransaction<{ taskId: string; merged: boolean }>(db, context, async (trx) => {
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
      });
    };

    try {
      if (span && context?.tracer) {
        return await context.tracer.withSpan(span, executeEnqueue);
      }
      return await executeEnqueue();
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
      const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

      return runInTransaction<{ taskId: string; merged: boolean }>(db, context, async (trx) => {
        await acquireOutboxAdvisoryLock(
          trx,
          buildOutboxLockKey({
            baseId: task.baseId,
            seedTableId: task.seedTableId,
            planHash: task.planHash,
            changeType: SEED_CHANGE_TYPE,
          })
        );
        // Check for existing pending seed task for same base/table/changeType
        const existing = await trx
          .selectFrom(OUTBOX_TABLE)
          .selectAll()
          .where('base_id', '=', task.baseId)
          .where('seed_table_id', '=', task.seedTableId)
          .where('plan_hash', '=', task.planHash)
          .where('change_type', '=', SEED_CHANGE_TYPE)
          .where('status', '=', DEFAULT_STATUS)
          .forUpdate()
          .executeTakeFirst();

        if (!existing) {
          const taskId = await this.insertSeedTask(trx, task, now);
          return ok({ taskId, merged: false });
        }

        // Merge with existing task
        const taskId = String(existing.id);

        // Parse existing payload from row
        const existingPayload = parseSeedPayloadFromRow(existing);
        const mergedPayload = mergeSeedPayloads(existingPayload, task);

        // Check if we need to use seed table for overflow
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
            // Store seed meta in dirty_stats column (repurposed for seed tasks)
            dirty_stats: toJsonValue({
              changeType: mergedPayload.changeType,
              impact: mergedPayload.impact ?? null,
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

        return ok({ taskId, merged: true });
      });
    };

    try {
      if (span && context?.tracer) {
        return await context.tracer.withSpan(span, executeEnqueue);
      }
      return await executeEnqueue();
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
      const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

      return runInTransaction(db, context, async (trx) => {
        const rows = await trx
          .selectFrom(OUTBOX_TABLE)
          .selectAll()
          .where('status', '=', DEFAULT_STATUS)
          .where('next_run_at', '<=', now)
          .orderBy('created_at', 'asc')
          .limit(params.limit)
          .forUpdate()
          .skipLocked()
          .execute();

        if (rows.length === 0) return ok([]);

        const ids = rows.map((row) => String(row.id));
        await trx
          .updateTable(OUTBOX_TABLE)
          .set({
            status: 'processing',
            locked_at: now,
            locked_by: params.workerId,
            updated_at: now,
          })
          .where('id', 'in', ids)
          .execute();

        const seedMap = await this.loadSeedRecords(trx, rows);
        const tasks = rows.map((row) => toAnyOutboxItem(row, seedMap.get(String(row.id)) ?? []));

        return ok(tasks);
      });
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

  async markDone(taskId: string, context?: IExecutionContext): Promise<Result<void, DomainError>> {
    const span = context?.tracer?.startSpan('teable.outbox.markDone', {
      'outbox.taskId': taskId,
    });

    const executeMarkDone = async (): Promise<Result<void, DomainError>> => {
      const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;
      return runInTransaction(db, context, async (trx) => {
        await trx.deleteFrom(OUTBOX_TABLE).where('id', '=', taskId).execute();
        await trx.deleteFrom(OUTBOX_SEED_TABLE).where('task_id', '=', taskId).execute();
        return ok(undefined);
      });
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

  async markFailed(
    task: AnyOutboxItem,
    error: string,
    context?: IExecutionContext
  ): Promise<Result<void, DomainError>> {
    const span = context?.tracer?.startSpan('teable.outbox.markFailed', {
      'outbox.taskId': task.id,
      'outbox.attempts': task.attempts,
      'outbox.maxAttempts': task.maxAttempts,
    });

    const executeMarkFailed = async (): Promise<Result<void, DomainError>> => {
      const now = new Date();
      const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;
      const nextAttempts = task.attempts + 1;

      return runInTransaction(db, context, async (trx) => {
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

          this.logger.warn('computed:outbox:dead_letter', { taskId: task.id, error });
          return ok(undefined);
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

        this.logger.warn('computed:outbox:retry_scheduled', {
          taskId: task.id,
          attempts: nextAttempts,
          nextRunAt,
        });

        return ok(undefined);
      });
    };

    try {
      if (span && context?.tracer) {
        return await context.tracer.withSpan(span, executeMarkFailed);
      }
      return await executeMarkFailed();
    } finally {
      span?.end();
    }
  }

  private async insertOutbox(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    task: ComputedUpdateOutboxTaskInput,
    now: Date
  ): Promise<string> {
    const seedGroups = buildSeedGroupsFromTask(task);
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
        dirty_stats: toJsonValue(task.dirtyStats),
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

  private async insertSeedTask(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    task: ComputedUpdateSeedTaskInput,
    now: Date
  ): Promise<string> {
    const seedGroups = buildSeedGroupsFromSeedPayload(task);
    const seedCount = countSeedRecords(seedGroups);
    const useSeedTable = seedCount > this.config.seedInlineLimit;

    const record = await trx
      .insertInto(OUTBOX_TABLE)
      .values({
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
      })
      .returning('id')
      .executeTakeFirstOrThrow();

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
    steps: parseJsonArray(row.steps) ?? [],
    edges: parseJsonArray(row.edges) ?? [],
    estimatedComplexity: Number(row.estimated_complexity ?? 0),
    changeType: String(row.change_type) as ComputedUpdateOutboxItem['changeType'],
    planHash: String(row.plan_hash),
    dirtyStats: parseDirtyStats(row.dirty_stats),
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
  if (!Array.isArray(parsed)) return undefined;
  return parsed
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
      seedRecordIds.push(...group.recordIds);
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

interface PostgresTransactionContext<DB> {
  kind: 'unitOfWorkTransaction';
  db: Transaction<DB>;
}

const getPostgresTransaction = <DB>(context?: IExecutionContext): Transaction<DB> | null => {
  const transaction = context?.transaction as Partial<PostgresTransactionContext<DB>> | undefined;
  if (transaction?.kind === 'unitOfWorkTransaction' && transaction.db) {
    return transaction.db as Transaction<DB>;
  }
  return null;
};

const resolvePostgresDb = <DB>(
  db: Kysely<DB>,
  context?: IExecutionContext
): Kysely<DB> | Transaction<DB> => {
  return getPostgresTransaction<DB>(context) ?? db;
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
  fn: (trx: Kysely<DynamicDB> | Transaction<DynamicDB>) => Promise<Result<T, DomainError>>
): Promise<Result<T, DomainError>> => {
  const hasTransaction = Boolean(getPostgresTransaction(context));
  let attempt = 0;

  while (true) {
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
      if (
        !hasTransaction &&
        isRetryableTransactionError(error) &&
        attempt < OUTBOX_TX_MAX_RETRIES
      ) {
        const delayMs = backoffMs(attempt);
        attempt += 1;
        await sleep(delayMs);
        continue;
      }
      return err(
        domainError.infrastructure({
          message: `Outbox transaction failed: ${describeError(error)}`,
        })
      );
    }
  }
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
 * Build seed groups from any outbox item (only applicable for computed update tasks).
 */
const buildSeedGroupsFromAnyTask = (task: AnyOutboxItem): SeedGroup[] => {
  if (isFieldBackfillItem(task)) {
    // Field backfill tasks don't have seed records
    return [];
  }
  if (isSeedItem(task)) {
    return buildSeedGroupsFromSeedPayload(task);
  }
  return buildSeedGroupsFromTask(task);
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
    changedFieldIds: parseStringArray(row.affected_field_ids),
    changeType,
    impact,
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
    changedFieldIds: parseStringArray(row.affected_field_ids),
    changeType: parseSeedChangeType(row.dirty_stats) ?? 'update',
    impact: parseSeedImpact(row.dirty_stats),
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
      dirty_stats: seedTask.impact ? toJsonValue(seedTask.impact) : null,
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
    dirty_stats: toJsonValue(computedTask.dirtyStats),
    origin_run_ids: computedTask.originRunIds,
    run_total_steps: computedTask.runTotalSteps,
    run_completed_steps_before: computedTask.runCompletedStepsBefore,
    affected_table_ids: computedTask.affectedTableIds,
    affected_field_ids: computedTask.affectedFieldIds,
    sync_max_level: computedTask.syncMaxLevel,
  };
};
