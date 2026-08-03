import {
  getPostgresTransaction,
  resolvePostgresDbOrTx,
} from '@teable/v2-adapter-db-postgres-shared';
import {
  BaseId,
  ComputedActivity,
  domainError,
  FieldId,
  TableId,
  type DomainError,
  type FieldComputeTarget,
  type IExecutionContext,
  type ILogger,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely, Transaction } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { DynamicDB } from '../../query-builder';
import { buildAdvisoryLockQuery } from '../ComputedUpdateLock';
import {
  fieldActivityRowToDto,
  tableActivityRowToDto,
  toNumber,
} from './ComputedActivityRowMapper';
import type {
  ComputedActivityProjectionResult,
  ComputedActivityTaskMetrics,
  IComputedActivityProjector,
} from './IComputedActivityProjector';

const FIELD_ACTIVITY_TABLE = 'computed_field_activity';
const TABLE_ACTIVITY_TABLE = 'computed_table_activity';
const TASK_FIELD_REF_TABLE = 'computed_task_field_ref';

type DbLike = Kysely<DynamicDB> | Transaction<DynamicDB>;
type StoredActivityTarget = FieldComputeTarget & { baseId: BaseId };

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

  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger
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
    return this.serializeEnqueueProjection(params.targets, () =>
      this.run(
        context,
        async (trx) => {
          const now = params.now ?? new Date();
          await this.lockTouchedTables(trx, params.targets);
          const newTargets: FieldComputeTarget[] = [];
          for (const target of params.targets) {
            const inserted = await trx
              .insertInto(TASK_FIELD_REF_TABLE)
              .values({
                task_id: params.taskId,
                field_id: target.fieldId.toString(),
                table_id: target.tableId.toString(),
                base_id: baseId.toString(),
                was_processing: false,
                created_at: now,
              })
              .onConflict((oc) => oc.columns(['task_id', 'field_id']).doNothing())
              .returning(['field_id'])
              .execute();
            if (inserted.length > 0) newTargets.push(target);
          }
          if (newTargets.length === 0) return ok(null);
          await this.ensureActivityRows(trx, newTargets, baseId, now);

          const activityResult = await this.loadActivity(trx, newTargets);
          if (activityResult.isErr()) return err(activityResult.error);
          const activity = activityResult.value;
          activity.attachTask({
            baseId,
            targets: newTargets,
            estimatedComplexity: params.metrics.estimatedComplexity,
            estimatedDirtyRecords: params.metrics.estimatedDirtyRecords,
            hasAllTargetRecords: params.metrics.hasAllTargetRecords,
            batchProgress: params.metrics.batchProgress,
            now,
          });
          return ok(await this.persistSnapshot(trx, activity));
        },
        'activity_on_task_enqueued',
        params.trx
      )
    );
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
    return this.run(
      context,
      async (trx) => {
        const now = params.now ?? new Date();
        const taskIds: string[] = [];
        const targetsByField = new Map<string, StoredActivityTarget>();

        for (const task of params.tasks) {
          const refs = await trx
            .selectFrom(TASK_FIELD_REF_TABLE)
            .selectAll()
            .where('task_id', '=', task.taskId)
            .execute();

          const pendingRefs = refs.filter((ref) => ref.was_processing !== true);
          if (pendingRefs.length === 0) continue;
          taskIds.push(task.taskId);
          const parsedTargets = storedActivityTargets(
            pendingRefs as Array<Record<string, unknown>>
          );
          if (parsedTargets.isErr()) return err(parsedTargets.error);
          for (const target of parsedTargets.value) {
            targetsByField.set(target.fieldId.toString(), target);
          }
        }

        const targets = [...targetsByField.values()];
        if (targets.length === 0) return ok(null);
        await this.lockTouchedTables(trx, targets);

        await trx
          .updateTable(TASK_FIELD_REF_TABLE)
          .set({ was_processing: true })
          .where('task_id', 'in', taskIds)
          .where('was_processing', '=', false)
          .execute();

        const activityResult = await this.loadActivity(trx, targets);
        if (activityResult.isErr()) return err(activityResult.error);
        const activity = activityResult.value;
        const reconciledTargets = await Promise.all(
          targets.map(async (target) => ({
            ...target,
            processingTaskCount: await this.countProcessingRefs(trx, target.fieldId),
          }))
        );
        activity.reconcileProcessing({ targets: reconciledTargets, now });
        return ok(await this.persistSnapshot(trx, activity));
      },
      'activity_on_tasks_claimed',
      params.trx
    );
  }

  async onTaskDone(
    params: {
      taskId: string;
      baseId?: string;
      durationMs?: number;
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
    return this.run(
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
        await this.lockTouchedTables(trx, targets);

        await trx
          .updateTable(TASK_FIELD_REF_TABLE)
          .set({ was_processing: false })
          .where('task_id', '=', params.taskId)
          .execute();

        const activityResult = await this.loadActivity(trx, targets);
        if (activityResult.isErr()) return err(activityResult.error);
        const activity = activityResult.value;
        const reconciledTargets = await Promise.all(
          targets.map(async (target) => ({
            ...target,
            processingTaskCount: await this.countProcessingRefs(trx, target.fieldId),
          }))
        );
        activity.reconcileProcessing({
          targets: reconciledTargets,
          lastError: params.error,
          now,
        });
        return ok(await this.persistSnapshot(trx, activity));
      },
      'activity_on_task_failed_retry',
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
      trx?: DbLike;
    },
    context: IExecutionContext | undefined,
    operation: string
  ): Promise<Result<ComputedActivityProjectionResult | null, DomainError>> {
    return this.run(
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
        await this.lockTouchedTables(trx, targets);
        // Per-field wasProcessing: if any ref for this task on that field was processing.
        const processingByField = new Map<string, boolean>();
        for (const ref of refs) {
          const fieldId = String(ref.field_id);
          processingByField.set(
            fieldId,
            processingByField.get(fieldId) === true || ref.was_processing === true
          );
        }

        await trx.deleteFrom(TASK_FIELD_REF_TABLE).where('task_id', '=', params.taskId).execute();

        const activityResult = await this.loadActivity(trx, targets);
        if (activityResult.isErr()) return err(activityResult.error);
        const activity = activityResult.value;
        // Release per field so wasProcessing is accurate for mixed states.
        for (const target of targets) {
          activity.releaseTask({
            baseId,
            targets: [target],
            wasProcessing: processingByField.get(target.fieldId.toString()) === true,
            durationMs: params.durationMs,
            error: params.error,
            now,
          });
        }
        return ok(await this.persistSnapshot(trx, activity));
      },
      operation,
      params.trx
    );
  }

  private async ensureActivityRows(
    trx: DbLike,
    targets: ReadonlyArray<FieldComputeTarget>,
    baseId: BaseId,
    now: Date
  ): Promise<void> {
    const tableIds = [...new Set(targets.map((target) => target.tableId.toString()))].sort();
    for (const tableId of tableIds) {
      await trx
        .insertInto(TABLE_ACTIVITY_TABLE)
        .values({
          table_id: tableId,
          base_id: baseId.toString(),
          status: 'idle',
          calculating_field_count: 0,
          queued_field_count: 0,
          estimated_complexity: 0,
          recent_completions: JSON.stringify([]),
          generation: 0,
          updated_at: now,
        })
        .onConflict((oc) => oc.column('table_id').doNothing())
        .execute();
    }

    for (const target of targets) {
      await trx
        .insertInto(FIELD_ACTIVITY_TABLE)
        .values({
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
        })
        .onConflict((oc) => oc.column('field_id').doNothing())
        .execute();
    }
  }

  private async lockTouchedTables(
    trx: DbLike,
    targets: ReadonlyArray<Pick<FieldComputeTarget, 'tableId'>>
  ): Promise<void> {
    const tableIds = [...new Set(targets.map((target) => target.tableId.toString()))].sort();
    for (const tableId of tableIds) {
      await trx.executeQuery(buildAdvisoryLockQuery(trx, `v2:computed-activity:table:${tableId}`));
    }
  }

  private async countProcessingRefs(trx: DbLike, fieldId: FieldId): Promise<number> {
    const row = await trx
      .selectFrom(TASK_FIELD_REF_TABLE)
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('field_id', '=', fieldId.toString())
      .where('was_processing', '=', true)
      .executeTakeFirst();
    return toNumber(row?.count);
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
    const snapshot = activity.snapshot();
    for (const field of snapshot.fields) {
      await trx
        .insertInto(FIELD_ACTIVITY_TABLE)
        .values({
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
        })
        .onConflict((oc) =>
          oc.column('field_id').doUpdateSet({
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
          })
        )
        .execute();
    }

    for (const table of snapshot.tables) {
      await trx
        .insertInto(TABLE_ACTIVITY_TABLE)
        .values({
          table_id: table.tableId,
          base_id: table.baseId,
          status: table.status,
          calculating_field_count: table.calculatingFieldCount,
          queued_field_count: table.queuedFieldCount,
          estimated_complexity: table.estimatedComplexity,
          recent_completions: JSON.stringify(table.recentCompletions),
          generation: table.generation,
          updated_at: new Date(table.updatedAt),
        })
        .onConflict((oc) =>
          oc.column('table_id').doUpdateSet({
            base_id: table.baseId,
            status: table.status,
            calculating_field_count: table.calculatingFieldCount,
            queued_field_count: table.queuedFieldCount,
            estimated_complexity: table.estimatedComplexity,
            recent_completions: JSON.stringify(table.recentCompletions),
            generation: table.generation,
            updated_at: new Date(table.updatedAt),
          })
        )
        .execute();
    }

    return {
      baseId: snapshot.fields[0]?.baseId ?? snapshot.tables[0]?.baseId ?? '',
      fields: snapshot.fields,
      tables: snapshot.tables,
    };
  }

  private async serializeEnqueueProjection<T>(
    targets: ReadonlyArray<Pick<FieldComputeTarget, 'tableId'>>,
    project: () => Promise<T>
  ): Promise<T> {
    const reservations: Array<{
      key: string;
      tail: Promise<void>;
      release: () => void;
    }> = [];
    const keys = [...new Set(targets.map((target) => target.tableId.toString()))].sort();

    for (const key of keys) {
      const previous = this.enqueueProjectionTails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => gate);
      this.enqueueProjectionTails.set(key, tail);
      await previous;
      reservations.push({ key, tail, release });
    }

    try {
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
      return await db.transaction().execute(async (trx) => fn(trx as unknown as DbLike));
    } catch (error) {
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
