import {
  getPostgresTransaction,
  resolvePostgresDbOrTx,
} from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  HIGH_COMPLEXITY_THRESHOLD,
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

const buildDiagnostics = (
  fields: ReadonlyArray<FieldComputeMetaDto>
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
    activeFieldCount,
    queuedFieldCount,
    calculatingFieldCount,
    failedFieldCount,
    highComplexityFieldCount,
    anomalies,
  };
};

@injectable()
export class PostgresComputedActivityReader implements IComputedActivityReader {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2RecordRepositoryPostgresTokens.computedActivityProjector)
    private readonly activityProjector: IComputedActivityProjector
  ) {}

  async getByTableId(
    context: IExecutionContext | undefined,
    tableId: string
  ): Promise<Result<TableComputeActivitySnapshot, DomainError>> {
    try {
      const initial = await this.readSnapshot(context, tableId);
      if (initial.isErr()) return err(initial.error);

      const needsReconcile = await this.shouldReconcile(context, tableId, initial.value);
      if (!needsReconcile) return ok(initial.value);

      const reconciled = await this.activityProjector.reconcileTable(
        {
          tableId,
          baseId: initial.value.baseId || undefined,
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

      const healed = await this.readSnapshot(context, tableId);
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
    tableId: string
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
      const baseId = table?.baseId ?? fields[0]?.baseId ?? '';

      return ok({
        tableId,
        baseId,
        table,
        fields,
        diagnostics: buildDiagnostics(fields),
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
}
