import {
  getPostgresTransaction,
  resolvePostgresDbOrTx,
} from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  HIGH_COMPLEXITY_THRESHOLD,
  type ComputeActivityPauseBlocker,
  type ComputeActivityPauseDiagnostics,
  type DomainError,
  type FieldComputeMetaDto,
  type IComputedActivityReader,
  type IExecutionContext,
  type TableComputeActivitySnapshot,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { DynamicDB } from '../../query-builder';
import { fieldActivityRowToDto, tableActivityRowToDto } from './ComputedActivityRowMapper';
import type { IComputedActivityProjector } from './IComputedActivityProjector';

const FIELD_ACTIVITY_TABLE = 'computed_field_activity';
const TABLE_ACTIVITY_TABLE = 'computed_table_activity';
const PAUSE_SCOPE_TABLE = 'computed_update_pause_scope';

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
    if (field.status === 'failed') {
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

  private setReconcileCooldown(tableId: string): void {
    const now = Date.now();
    if (this.reconcileCooldownUntil.size >= RECONCILE_COOLDOWN_MAX_ENTRIES) {
      for (const [key, until] of this.reconcileCooldownUntil) {
        if (until <= now) this.reconcileCooldownUntil.delete(key);
      }
      if (this.reconcileCooldownUntil.size >= RECONCILE_COOLDOWN_MAX_ENTRIES) {
        this.reconcileCooldownUntil.clear();
      }
    }
    this.reconcileCooldownUntil.set(tableId, now + RECONCILE_COOLDOWN_MS);
  }

  async getByTableId(
    context: IExecutionContext | undefined,
    tableId: string,
    requestedBaseId?: string
  ): Promise<Result<TableComputeActivitySnapshot, DomainError>> {
    try {
      const initial = await this.readSnapshot(context, tableId, requestedBaseId);
      if (initial.isErr()) return err(initial.error);

      // Read-time healing is best-effort: drift detected here is repaired again on
      // the next poll, so a per-pod cooldown keeps the high-frequency activity
      // polls from re-running the drift checks and reconcile for the same table.
      const cooldownUntil = this.reconcileCooldownUntil.get(tableId) ?? 0;
      if (Date.now() < cooldownUntil) return ok(initial.value);

      const needsReconcile = await this.shouldReconcile(context, tableId, initial.value);
      if (!needsReconcile) return ok(initial.value);

      this.setReconcileCooldown(tableId);
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
        // Prefer returning the last known snapshot over failing the diagnostics endpoint.
        return ok(initial.value);
      }

      if (!reconciled.value) return ok(initial.value);

      // Push healed activity to realtime clients so connected ShareDB docs catch up.
      if (
        'publishActivityChanged' in this.activityProjector &&
        typeof this.activityProjector.publishActivityChanged === 'function'
      ) {
        await this.activityProjector.publishActivityChanged(reconciled.value, context);
      }

      const healed = await this.readSnapshot(context, tableId, requestedBaseId);
      if (healed.isErr()) return ok(initial.value);
      return ok(healed.value);
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
    snapshot: TableComputeActivitySnapshot
  ): Promise<boolean> {
    const db = (getPostgresTransaction(context) ??
      resolvePostgresDbOrTx(this.db, context)) as unknown as Kysely<DynamicDB>;

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
    const queuedFieldCount = snapshot.fields.filter((field) => field.status === 'queued').length;
    const calculatingFieldCount = snapshot.fields.filter(
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
    requestedBaseId?: string
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
      const table = tableRow ? tableActivityRowToDto(tableRow as Record<string, unknown>) : null;
      const baseId = table?.baseId ?? fields[0]?.baseId ?? requestedBaseId ?? '';
      // Pause diagnostics are supplementary. A data database provisioned before the pause table
      // existed, or one whose role cannot read it, must not strip computeMeta off every table read.
      const pause = await this.readPauseDiagnostics(context, tableId, baseId).catch(() =>
        emptyPauseDiagnostics()
      );

      return ok({
        tableId,
        baseId,
        table,
        fields,
        diagnostics: buildDiagnostics(fields, pause),
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
    baseId: string
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
      const base = (await metadataDb
        .selectFrom('base')
        .select('space_id')
        .where('id', '=', baseId)
        .executeTakeFirst()) as { space_id: string | null } | undefined;
      spaceId = base?.space_id ?? undefined;
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
