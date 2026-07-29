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
const ACTIVITY_WRITE_BATCH_SIZE = 500;

type DbLike = Kysely<DynamicDB> | Transaction<DynamicDB>;
type StoredActivityTarget = FieldComputeTarget & { baseId: BaseId };

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
    return this.serializeEnqueueProjection(params.targets, () =>
      this.run(
        context,
        async (trx) => {
          const now = params.now ?? new Date();
          await this.lockTouchedTables(trx, params.targets);
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

        const requestedTaskIds = [...new Set(params.tasks.map((task) => task.taskId))];
        const pendingRefs = await trx
          .selectFrom(TASK_FIELD_REF_TABLE)
          .selectAll()
          .where('task_id', 'in', requestedTaskIds)
          .where('was_processing', '=', false)
          .execute();
        if (pendingRefs.length === 0) return ok(null);

        taskIds.push(...new Set(pendingRefs.map((ref) => String(ref.task_id))));
        const parsedTargets = storedActivityTargets(pendingRefs as Array<Record<string, unknown>>);
        if (parsedTargets.isErr()) return err(parsedTargets.error);
        for (const target of parsedTargets.value) {
          targetsByField.set(target.fieldId.toString(), target);
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
  }

  async reconcileTable(
    params: {
      tableId: string;
      baseId?: string;
      now?: Date;
      trx?: DbLike;
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
        await this.lockTouchedTables(trx, [{ tableId }]);

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

        if (fieldRows.length === 0 && !tableRow) return ok(null);

        const baseIdRaw =
          params.baseId ??
          (tableRow ? String(tableRow.base_id) : undefined) ??
          (fieldRows[0] ? String(fieldRows[0].base_id) : undefined);
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

        if (fieldRows.length > 0) {
          const targetsResult = storedActivityTargets(
            fieldRows as Array<Record<string, unknown>>,
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
          const synced = await this.syncActivityFromTaskRefs(trx, activity, targets, now);
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
        const synced = await this.syncActivityFromTaskRefs(trx, activity, targets, now);
        if (synced.isErr()) return err(synced.error);
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

  private async lockTouchedTables(
    trx: DbLike,
    targets: ReadonlyArray<Pick<FieldComputeTarget, 'tableId'>>
  ): Promise<void> {
    const tableIds = [...new Set(targets.map((target) => target.tableId.toString()))].sort();
    for (const tableId of tableIds) {
      await trx.executeQuery(buildAdvisoryLockQuery(trx, `v2:computed-activity:table:${tableId}`));
    }
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
    now: Date
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
      fields: projection.fields,
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
