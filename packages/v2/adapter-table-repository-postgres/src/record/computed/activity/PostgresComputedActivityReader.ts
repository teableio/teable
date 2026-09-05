import {
  getPostgresTransaction,
  PostgresUnitOfWorkTransaction,
  resolvePostgresDbOrTx,
} from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  bindUnitOfWorkTransaction,
  domainError,
  emptyComputeReliability,
  summarizeFieldComputeReliability,
  HIGH_COMPLEXITY_THRESHOLD,
  type ComputeActivityPauseBlocker,
  type ComputeReliability,
  type ComputeActivityPauseDiagnostics,
  type DomainError,
  type FieldComputeMetaDto,
  type IComputedActivityReader,
  type IExecutionContext,
  type TableComputeActivitySnapshot,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely, type CompiledQuery, type QueryResult } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { DynamicDB } from '../../query-builder';
import { isComputedReliabilityVisible } from '../reliability/config';
import { PostgresComputedReliabilityStore } from '../reliability/PostgresComputedReliabilityStore';
import { fieldActivityRowToDto, tableActivityRowToDto } from './ComputedActivityRowMapper';
import type { IComputedActivityProjector } from './IComputedActivityProjector';

const FIELD_ACTIVITY_TABLE = 'computed_field_activity';
const TABLE_ACTIVITY_TABLE = 'computed_table_activity';
const PAUSE_SCOPE_TABLE = 'computed_update_pause_scope';

type LoadedActivityState = {
  projectedFields: FieldComputeMetaDto[];
  reliabilitySummaries?: Map<string, ComputeReliability>;
  reliabilityLoaded?: boolean;
  reliabilityUnavailable?: boolean;
  reliabilityEntries?: Awaited<ReturnType<PostgresComputedReliabilityStore['getFieldSummaries']>>;
  tableReliability?: ComputeReliability | null;
};

type PauseScopeRow = {
  id: string;
  scope_type: 'space' | 'base' | 'table';
  scope_id: string;
  paused_at: Date | string;
  paused_by: string | null;
  resume_at: Date | string | null;
  reason: string | null;
};

// Long enough to collapse the ~2/s poll cadence per table into one reconcile
// attempt per window, short enough that persistent drift still heals within a
// few poll ticks after churn subsides.
const RECONCILE_COOLDOWN_MS = 15_000;
const RECONCILE_COOLDOWN_MAX_ENTRIES = 10_000;

const emptyPauseDiagnostics = (): ComputeActivityPauseDiagnostics => ({
  effective: false,
  blockers: [],
  queuedTaskCount: 0,
  oldestQueuedAt: null,
});

const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const toPauseBlocker = (row: PauseScopeRow): ComputeActivityPauseBlocker => ({
  id: row.id,
  scopeType: row.scope_type,
  scopeId: row.scope_id,
  pausedAt: toIsoString(row.paused_at),
  pausedBy: row.paused_by,
  resumeAt: row.resume_at == null ? null : toIsoString(row.resume_at),
  reason: row.reason,
});

const buildDiagnostics = (
  fields: ReadonlyArray<FieldComputeMetaDto>,
  pause: ComputeActivityPauseDiagnostics
): TableComputeActivitySnapshot['diagnostics'] => {
  const anomalies: TableComputeActivitySnapshot['diagnostics']['anomalies'] = [];
  let activeFieldCount = 0;
  let queuedFieldCount = 0;
  let calculatingFieldCount = 0;
  let failedFieldCount = 0;
  let highComplexityFieldCount = 0;

  for (const field of fields) {
    if (field.status === 'queued' || field.status === 'running') {
      activeFieldCount += 1;
    }
    if (field.status === 'queued') queuedFieldCount += 1;
    if (field.status === 'running') calculatingFieldCount += 1;
    if (field.status === 'failed' || (field.reliability?.unresolvedCount ?? 0) > 0) {
      failedFieldCount += 1;
      anomalies.push({
        fieldId: field.fieldId,
        kind: 'failed',
        message: field.lastError?.message ?? 'Computed field calculation failed',
      });
    }
    if (field.estimatedComplexity >= HIGH_COMPLEXITY_THRESHOLD) {
      highComplexityFieldCount += 1;
      anomalies.push({
        fieldId: field.fieldId,
        kind: 'high_complexity',
        message: `Estimated complexity ${field.estimatedComplexity} exceeds threshold ${HIGH_COMPLEXITY_THRESHOLD}`,
        estimatedComplexity: field.estimatedComplexity,
      });
    }
    if (field.hasAllTargetRecords && field.status !== 'idle') {
      anomalies.push({
        fieldId: field.fieldId,
        kind: 'all_target_records',
        message: 'Full-table recompute in progress or recently projected',
      });
    }
  }

  return {
    reliability: fields.some((field) => field.reliability)
      ? summarizeFieldComputeReliability(fields)
      : undefined,
    computeMode: 'server',
    executionState: pause.effective ? 'paused' : 'running',
    activeFieldCount,
    queuedFieldCount,
    calculatingFieldCount,
    failedFieldCount,
    highComplexityFieldCount,
    anomalies,
    pause,
  };
};

@injectable()
export class PostgresComputedActivityReader implements IComputedActivityReader {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2RecordRepositoryPostgresTokens.computedActivityProjector)
    private readonly activityProjector: IComputedActivityProjector,
    @inject(v2RecordRepositoryPostgresTokens.metaDb)
    private readonly metaDb: Kysely<V1TeableDatabase> = db
  ) {}

  // Per-pod, per-table gate on read-time reconcile attempts. The advisory lock
  // already makes reconcile single-flight across pods; this only spaces out how
  // often each pod re-checks, so a table under heavy churn is not re-examined on
  // every poll tick.
  private readonly reconcileCooldownUntil = new Map<string, number>();
  private readonly pendingReconciliation = new Set<string>();

  private setReconcileCooldown(tableId: string): void {
    const now = Date.now();
    if (this.reconcileCooldownUntil.size >= RECONCILE_COOLDOWN_MAX_ENTRIES) {
      for (const [key, until] of this.reconcileCooldownUntil) {
        if (until <= now) {
          this.reconcileCooldownUntil.delete(key);
          this.pendingReconciliation.delete(key);
        }
      }
      if (this.reconcileCooldownUntil.size >= RECONCILE_COOLDOWN_MAX_ENTRIES) {
        this.reconcileCooldownUntil.clear();
        this.pendingReconciliation.clear();
      }
    }
    this.reconcileCooldownUntil.set(tableId, now + RECONCILE_COOLDOWN_MS);
  }

  async getByTableId(
    context: IExecutionContext | undefined,
    tableId: string,
    requestedBaseId?: string,
    options?: {
      budgetMs?: number;
      readableFieldIds?: readonly string[];
      includePauseDiagnostics?: boolean;
    }
  ): Promise<Result<TableComputeActivitySnapshot, DomainError>> {
    if (options?.budgetMs === undefined)
      return this.readActivity(context, tableId, requestedBaseId, false, options?.readableFieldIds);
    if (
      !Number.isFinite(options.budgetMs) ||
      options.budgetMs <= 0 ||
      getPostgresTransaction(context)
    ) {
      return err(
        domainError.validation({
          message: 'A positive read budget requires a standalone transaction',
        })
      );
    }
    const deadline = Date.now() + Math.min(options.budgetMs, 5000);
    let unit: PostgresUnitOfWorkTransaction<V1TeableDatabase> | undefined;
    try {
      const value = await this.db.transaction().execute(async (trx) => {
        unit = new PostgresUnitOfWorkTransaction(trx, 'data');
        const scopedContext = bindUnitOfWorkTransaction(
          context ?? { actorId: ActorId.create('system')._unsafeUnwrap() },
          unit
        );
        const connection = await trx.getExecutor().provideConnection(async (value) => value);
        {
          const original = connection.executeQuery;
          const execute = original.bind(connection);
          // The transaction exclusively owns this connection. Restore before commit/rollback.
          connection.executeQuery = async <R>(query: CompiledQuery): Promise<QueryResult<R>> => {
            const remaining = Math.floor(deadline - Date.now());
            if (remaining <= 0) throw new Error('Compute activity read budget exceeded');
            await execute(
              sql`select set_config('statement_timeout', ${String(remaining)}, true)`.compile(trx)
            );
            const result = await execute<R>(query);
            if (Date.now() >= deadline) throw new Error('Compute activity read budget exceeded');
            return result;
          };
          try {
            const result = await this.readActivity(
              scopedContext,
              tableId,
              requestedBaseId,
              true,
              options?.readableFieldIds,
              options?.includePauseDiagnostics ? deadline : undefined
            );
            if (result.isErr()) throw result.error;
            if (Date.now() >= deadline) throw new Error('Compute activity read budget exceeded');
            return result.value;
          } finally {
            connection.executeQuery = original;
          }
        }
      });
      await unit?.runAfterCommitHandlers();
      return ok(value);
    } catch (error) {
      await unit?.runAfterRollbackHandlers();
      return err(
        domainError.infrastructure({
          message: 'Compute activity read budget failed',
          details: { tableId, error: error instanceof Error ? error.message : String(error) },
        })
      );
    }
  }

  private async readActivity(
    context: IExecutionContext | undefined,
    tableId: string,
    requestedBaseId?: string,
    budgeted = false,
    readableFieldIds?: readonly string[],
    pauseDeadline?: number
  ): Promise<Result<TableComputeActivitySnapshot, DomainError>> {
    try {
      const loaded: LoadedActivityState = { projectedFields: [] };
      const initial = await this.readSnapshot(
        context,
        tableId,
        requestedBaseId,
        loaded,
        budgeted && pauseDeadline === undefined,
        readableFieldIds,
        pauseDeadline
      );
      if (initial.isErr()) return err(initial.error);

      // Read-time healing is best-effort: drift detected here is repaired again on
      // the next poll, so a per-pod cooldown keeps the high-frequency activity
      // polls from re-running the drift checks and reconcile for the same table.
      const cooldownUntil = this.reconcileCooldownUntil.get(tableId) ?? 0;
      if (Date.now() < cooldownUntil)
        return ok(
          this.pendingReconciliation.has(tableId)
            ? { ...initial.value, observationState: 'syncing' }
            : initial.value
        );

      // Rate limit healthy checks too, not just repairs.
      this.setReconcileCooldown(tableId);
      const needsReconcile = await this.shouldReconcile(context, tableId, initial.value, loaded);
      if (!needsReconcile) {
        this.pendingReconciliation.delete(tableId);
        return ok(initial.value);
      }

      this.setReconcileCooldown(tableId);
      this.pendingReconciliation.add(tableId);
      // lockTimeoutMs: 0 — if the per-table advisory lock is contended, another
      // connection (possibly on another pod) is already reconciling; return the
      // stale snapshot instead of parking this request's pool connection on the
      // global lock. Waiting here once turned polling traffic into a
      // cross-pod thundering herd that drained every pool (2026-08-14 CN outage).
      const reconciled = await this.activityProjector.reconcileTable(
        {
          tableId,
          baseId: initial.value.baseId || undefined,
          lockTimeoutMs: 0,
        },
        context
      );
      if (reconciled.isErr()) {
        if (budgeted) return err(reconciled.error);
        // Prefer returning the last known snapshot over failing the diagnostics endpoint.
        return ok({ ...initial.value, observationState: 'syncing' });
      }

      if (!reconciled.value) return ok({ ...initial.value, observationState: 'syncing' });

      // Push healed activity to realtime clients so connected ShareDB docs catch up.
      if (
        'publishActivityChanged' in this.activityProjector &&
        typeof this.activityProjector.publishActivityChanged === 'function'
      ) {
        await this.activityProjector.publishActivityChanged(reconciled.value, context);
      }

      const healed = await this.readSnapshot(
        context,
        tableId,
        requestedBaseId,
        loaded,
        budgeted && pauseDeadline === undefined,
        readableFieldIds,
        pauseDeadline
      );
      if (healed.isErr())
        return budgeted ? err(healed.error) : ok({ ...initial.value, observationState: 'syncing' });
      this.pendingReconciliation.delete(tableId);
      return ok({
        ...healed.value,
        reconciliationPerformed: budgeted || !getPostgresTransaction(context),
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: 'Failed to load compute activity',
          details: {
            tableId,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      );
    }
  }

  private async shouldReconcile(
    context: IExecutionContext | undefined,
    tableId: string,
    snapshot: TableComputeActivitySnapshot,
    loaded: LoadedActivityState
  ): Promise<boolean> {
    const db = (getPostgresTransaction(context) ??
      resolvePostgresDbOrTx(this.db, context)) as unknown as Kysely<DynamicDB>;

    // Persisted issue state also needs healing after a lost projection event or
    // manual closure. Compare against the actual projection, not our HTTP overlay.
    if (loaded.reliabilitySummaries) {
      const summaries = loaded.reliabilitySummaries;
      if (
        [...summaries.keys()].some(
          (id) => !loaded.projectedFields.some((field) => field.fieldId === id)
        )
      )
        return true;
      if (
        loaded.projectedFields.some(
          (field) =>
            JSON.stringify(field.reliability) !==
            JSON.stringify(summaries.get(field.fieldId) ?? emptyComputeReliability())
        )
      )
        return true;
    }

    // Cheap existence checks only (indexed table_id). Never scan on every healthy poll.
    const dangling = await db
      .selectFrom('computed_task_field_ref as refs')
      .select('refs.task_id')
      .where('refs.table_id', '=', tableId)
      .where(({ exists, not, selectFrom }) =>
        not(
          exists(
            selectFrom('computed_update_outbox as outbox')
              .select('outbox.id')
              .whereRef('outbox.id', '=', 'refs.task_id')
          )
        )
      )
      .limit(1)
      .executeTakeFirst();
    if (dangling) return true;

    // A live ref whose field has no activity row at all (async-projection events
    // lost before their first flush). The mismatch query below joins FROM the
    // activity table, so this state is invisible to it.
    const missingActivityRow = await db
      .selectFrom('computed_task_field_ref as refs')
      .select('refs.field_id')
      .where('refs.table_id', '=', tableId)
      .where(({ exists, not, selectFrom }) =>
        not(
          exists(
            selectFrom('computed_field_activity as activity')
              .select('activity.field_id')
              .whereRef('activity.field_id', '=', 'refs.field_id')
          )
        )
      )
      .limit(1)
      .executeTakeFirst();
    if (missingActivityRow) return true;

    const refs = db
      .selectFrom('computed_task_field_ref')
      .select([
        'field_id',
        sql<number>`count(*)::int`.as('active_task_count'),
        sql<number>`count(*) filter (where was_processing = true)::int`.as('processing_task_count'),
      ])
      .where('table_id', '=', tableId)
      .groupBy('field_id')
      .as('refs');

    // Compare every field projection with its authoritative refs. A healthy ref on
    // field B must not hide a missing ref (or under-count) on field A.
    const mismatchedField = await db
      .selectFrom('computed_field_activity as activity')
      .leftJoin(refs, 'refs.field_id', 'activity.field_id')
      .select('activity.field_id')
      .where('activity.table_id', '=', tableId)
      .where(
        sql<boolean>`
        activity.active_task_count <> COALESCE(refs.active_task_count, 0)
        OR activity.processing_task_count <> COALESCE(refs.processing_task_count, 0)
        OR activity.status <> CASE
          WHEN COALESCE(refs.active_task_count, 0) = 0 AND activity.status = 'failed'
            THEN 'failed'
          WHEN COALESCE(refs.active_task_count, 0) = 0 THEN 'idle'
          WHEN COALESCE(refs.processing_task_count, 0) > 0 THEN 'running'
          ELSE 'queued'
        END
      `
      )
      .limit(1)
      .executeTakeFirst();
    if (mismatchedField) return true;

    // Field counters may be healthy while the table aggregate alone drifted.
    const queuedFieldCount = loaded.projectedFields.filter(
      (field) => field.status === 'queued'
    ).length;
    const calculatingFieldCount = loaded.projectedFields.filter(
      (field) => field.status === 'running'
    ).length;
    const expectedTableStatus =
      queuedFieldCount + calculatingFieldCount > 0 ? 'calculating' : 'idle';
    return Boolean(
      snapshot.table &&
        (snapshot.table.status !== expectedTableStatus ||
          snapshot.table.queuedFieldCount !== queuedFieldCount ||
          snapshot.table.calculatingFieldCount !== calculatingFieldCount)
    );
  }

  private async readSnapshot(
    context: IExecutionContext | undefined,
    tableId: string,
    requestedBaseId?: string,
    loaded?: LoadedActivityState,
    skipPauseDiagnostics = false,
    readableFieldIds?: readonly string[],
    pauseDeadline?: number
  ): Promise<Result<TableComputeActivitySnapshot, DomainError>> {
    try {
      const db = (getPostgresTransaction(context) ??
        resolvePostgresDbOrTx(this.db, context)) as unknown as Kysely<DynamicDB>;

      const fieldRows = await db
        .selectFrom(FIELD_ACTIVITY_TABLE)
        .selectAll()
        .where('table_id', '=', tableId)
        .execute();

      const tableRow = await db
        .selectFrom(TABLE_ACTIVITY_TABLE)
        .selectAll()
        .where('table_id', '=', tableId)
        .executeTakeFirst();

      const fields = fieldRows.map((row) => fieldActivityRowToDto(row as Record<string, unknown>));
      if (loaded) loaded.projectedFields = fields.map((field) => ({ ...field }));
      const state = loaded ?? { projectedFields: [] };
      const visible = isComputedReliabilityVisible(
        requestedBaseId ?? fields[0]?.baseId ?? String(tableRow?.base_id ?? '')
      );
      if (!state.reliabilityLoaded) {
        state.reliabilityLoaded = true;
        const store = new PostgresComputedReliabilityStore(db);
        if (visible) {
          if (await store.isReady()) {
            state.tableReliability = await store.getTableSummary(tableId, readableFieldIds, true);
            state.reliabilityEntries = await store.getFieldSummaries(tableId, true);
          } else {
            state.reliabilityUnavailable = true;
          }
        }
      }

      if (visible && state.reliabilityEntries) {
        const summaries = new Map(state.reliabilityEntries.map((item) => [item.fieldId, item]));
        if (loaded)
          loaded.reliabilitySummaries = new Map(
            [...summaries].map(([id, item]) => [id, item.reliability])
          );
        for (const field of fields) {
          const summary = summaries.get(field.fieldId);
          field.reliability = summary?.reliability ?? emptyComputeReliability();

          if (field.reliability.unresolvedCount > 0 && field.activeTaskCount === 0)
            field.status = 'failed';
          summaries.delete(field.fieldId);
        }
        for (const item of summaries.values()) {
          fields.push({
            fieldId: item.fieldId,
            tableId,
            baseId: item.baseId,
            status: 'failed',
            activeTaskCount: 0,
            processingTaskCount: 0,
            generation: 0,
            estimatedComplexity: 0,
            estimatedDirtyRecords: 0,
            hasAllTargetRecords: false,
            updatedAt: new Date().toISOString(),
            reliability: item.reliability,
          });
        }
      }
      if (
        !isComputedReliabilityVisible(
          requestedBaseId ?? fields[0]?.baseId ?? String(tableRow?.base_id ?? '')
        )
      ) {
        for (const field of fields) field.reliability = undefined;
      }
      const table = tableRow ? tableActivityRowToDto(tableRow as Record<string, unknown>) : null;
      const baseId = table?.baseId ?? fields[0]?.baseId ?? requestedBaseId ?? '';
      // Pause diagnostics are supplementary. A data database provisioned before the pause table
      // existed, or one whose role cannot read it, must not strip computeMeta off every table read.
      // Background budgeted snapshots omit supplemental pause data. Interactive
      // reads cover pause SQL and the rare metadata lookup with the same deadline.
      const pause = skipPauseDiagnostics
        ? emptyPauseDiagnostics()
        : pauseDeadline !== undefined
          ? await this.readPauseDiagnostics(context, tableId, baseId, pauseDeadline)
          : await this.readPauseDiagnostics(context, tableId, baseId).catch(() =>
              emptyPauseDiagnostics()
            );

      const visibleFields =
        readableFieldIds === undefined
          ? fields
          : fields.filter((field) => readableFieldIds.includes(field.fieldId));
      const diagnostics = buildDiagnostics(visibleFields, pause);
      if (state.tableReliability) diagnostics.reliability = state.tableReliability;
      return ok({
        observedAt: new Date().toISOString(),
        observationState: state.reliabilityUnavailable ? 'unavailable' : 'available',
        tableId,
        baseId,
        table,
        fields: visibleFields,
        reliabilityIsAccessScoped: readableFieldIds !== undefined,
        diagnostics,
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: 'Failed to load compute activity',
          details: {
            tableId,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      );
    }
  }

  private async readPauseDiagnostics(
    context: IExecutionContext | undefined,
    tableId: string,
    baseId: string,
    deadline?: number
  ): Promise<ComputeActivityPauseDiagnostics> {
    const db = (getPostgresTransaction(context) ??
      resolvePostgresDbOrTx(this.db, context)) as unknown as Kysely<DynamicDB>;

    // Read the pause table first. This runs on every getTableById, and in the overwhelmingly
    // common case (no active pause) it must not cost a cross-database base lookup.
    const candidateRows = (await db
      .selectFrom(PAUSE_SCOPE_TABLE)
      .select(['id', 'scope_type', 'scope_id', 'paused_at', 'paused_by', 'resume_at', 'reason'])
      .where((eb) =>
        eb.or([eb('resume_at', 'is', null), eb('resume_at', '>', sql`current_timestamp`)])
      )
      .where((eb) =>
        eb.or([
          eb.and([eb('scope_type', '=', 'table'), eb('scope_id', '=', tableId)]),
          ...(baseId ? [eb.and([eb('scope_type', '=', 'base'), eb('scope_id', '=', baseId)])] : []),
          // Space scopes are keyed by spaceId, which is not known yet; they are filtered below
          // once a space-scoped pause is proven to exist. Active space pauses are rare.
          eb('scope_type', '=', 'space'),
        ])
      )
      .orderBy('paused_at', 'asc')
      .orderBy('id', 'asc')
      .execute()) as PauseScopeRow[];

    if (candidateRows.length === 0) return emptyPauseDiagnostics();

    let spaceId: string | undefined;
    if (baseId && candidateRows.some((row) => row.scope_type === 'space')) {
      const metadataScope = this.db === this.metaDb ? 'data' : 'meta';
      const metadataDb = resolvePostgresDbOrTx(
        this.metaDb,
        context,
        metadataScope
      ) as unknown as Kysely<DynamicDB>;
      const lookupBase = (queryDb: Kysely<DynamicDB>) =>
        queryDb.selectFrom('base').select('space_id').where('id', '=', baseId).executeTakeFirst();
      const base =
        deadline !== undefined && metadataScope === 'meta'
          ? await metadataDb.transaction().execute(async (trx) => {
              const remaining = Math.floor(deadline - Date.now());
              if (remaining <= 0) throw new Error('Compute activity read budget exceeded');
              await sql`select set_config('statement_timeout', ${String(remaining)}, true)`.execute(
                trx
              );
              return lookupBase(trx);
            })
          : await lookupBase(metadataDb);
      spaceId = typeof base?.space_id === 'string' ? base.space_id : undefined;
    }

    const rows = candidateRows.filter(
      (row) => row.scope_type !== 'space' || (spaceId != null && row.scope_id === spaceId)
    );

    if (rows.length === 0) return emptyPauseDiagnostics();

    const backlog = (await db
      .selectFrom('computed_task_field_ref as refs')
      .innerJoin('computed_update_outbox as outbox', 'outbox.id', 'refs.task_id')
      .select([
        sql<number>`count(distinct outbox.id)::int`.as('queued_task_count'),
        sql<Date | string | null>`min(outbox.created_at)`.as('oldest_queued_at'),
      ])
      .where('refs.table_id', '=', tableId)
      .where('outbox.status', '=', 'pending')
      .executeTakeFirst()) as
      | { queued_task_count: number | string; oldest_queued_at: Date | string | null }
      | undefined;

    return {
      effective: true,
      blockers: rows.map(toPauseBlocker),
      queuedTaskCount: Number(backlog?.queued_task_count ?? 0),
      oldestQueuedAt:
        backlog?.oldest_queued_at == null ? null : toIsoString(backlog.oldest_queued_at),
    };
  }
}
