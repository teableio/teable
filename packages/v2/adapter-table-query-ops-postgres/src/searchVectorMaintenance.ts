import { type DomainError, type IExecutionContext } from '@teable/v2-core';
import {
  TableQueryRemediationTask,
  type TableSearchVectorSchemaMaintenanceSchedule,
  type TableSearchVectorSchemaMaintenanceScheduler,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { toInfrastructureError } from './helpers';
import type { UnknownPostgresDatabase } from './types';

export type SearchMaintenanceOptions = {
  readonly windowUtc?: string;
  readonly knownSmallRowCap?: number;
  readonly allowUnknownOrLargeRewrite?: boolean;
  /** Host connection taxonomy, shared with cold-route execution resolution. */
  readonly isConnectionUnavailable?: (error: unknown) => boolean;
};

export const isSearchMaintenanceWindow = (windowUtc: string | undefined, now: Date): boolean => {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(windowUtc ?? '');
  if (!match) return false;
  const [, startHour, startMinute, endHour, endMinute] = match.map(Number);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return false;
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  return start < end
    ? minute >= start && minute < end
    : start > end && (minute >= start || minute < end);
};

export class SearchMaintenanceDeferred extends Error {}

type SearchVectorConfigRow = {
  readonly id: string;
  readonly candidate_key: string;
  readonly search_scope: 'all_fields' | 'selected_fields';
};

type QueuedTaskRow = {
  readonly id: string;
};

export class PostgresTableSearchVectorSchemaMaintenanceScheduler implements TableSearchVectorSchemaMaintenanceScheduler {
  constructor(private readonly metaDb: Kysely<UnknownPostgresDatabase>) {}

  async schedule(
    _context: IExecutionContext,
    input: Parameters<TableSearchVectorSchemaMaintenanceScheduler['schedule']>[1]
  ): Promise<Result<TableSearchVectorSchemaMaintenanceSchedule | undefined, DomainError>> {
    const tableId = input.table.id().toString();
    const baseId = input.table.baseId().toString();

    try {
      const scheduled = await this.metaDb.transaction().execute(async (trx) => {
        // Queue mutations use the same ordering as admission, claims and cancellation.
        await sql`SELECT pg_advisory_xact_lock(hashtextextended('table-query-ops:claim', 0))`.execute(
          trx
        );
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`table-query-ops:submit:${tableId}`}, 0))`.execute(
          trx
        );
        await sql`
          SELECT pg_advisory_xact_lock(
            hashtext('teable.table_query_ops.search_vector_maintenance'),
            hashtext(${tableId}::text)
          )
        `.execute(trx);

        const config = await sql<SearchVectorConfigRow>`
          SELECT id, candidate_key, search_scope
          FROM table_query_search_vector_config
          WHERE table_id = ${tableId}
            AND status IN ('ready', 'stale', 'rebuild_pending')
          ORDER BY (status = 'ready') DESC, last_modified_time DESC NULLS LAST, created_time DESC NULLS LAST, id DESC
          LIMIT 1
        `.execute(trx);
        const activeConfig = config.rows[0];
        if (!activeConfig) return undefined;

        // Pending is lifecycle state, not proof that a document is unusable.
        // Runtime verifies the physical path and retains compatible coverage.
        await sql`
          UPDATE table_query_search_vector_config
          SET status = 'rebuild_pending',
              last_inspection = jsonb_build_object(
                'state', 'rebuild_pending',
                'reason', ${input.reason}::text
              ),
              last_modified_time = now()
          WHERE table_id = ${tableId}
            AND (status IN ('ready', 'rebuild_pending') OR id = ${activeConfig.id})
        `.execute(trx);

        const queued = await sql<QueuedTaskRow>`
          SELECT id
          FROM table_query_remediation_task
          WHERE table_id = ${tableId}
            AND kind IN ('rebuild_search_access_path', 'rebuild_search_vector')
            AND status = 'queued'
            AND attempts = 0
            AND payload ->> 'trigger' = 'schema_change'
            AND locked_at IS NULL AND locked_by IS NULL
            AND execution_state IS NULL
          ORDER BY created_time DESC
          LIMIT 1
        `.execute(trx);
        const existing = queued.rows[0];
        if (existing) {
          await sql`
            UPDATE table_query_remediation_task
            SET payload = ${JSON.stringify({
              trigger: 'schema_change',
              reason: input.reason,
              configKey: activeConfig.candidate_key,
              configScope: activeConfig.search_scope,
            })}::jsonb,
                last_modified_time = now()
            WHERE id = ${existing.id}
          `.execute(trx);
          return {
            tableId,
            taskId: existing.id,
            status: 'coalesced' as const,
          };
        }

        const task = TableQueryRemediationTask.createQueued({
          tableId,
          baseId,
          kind: 'rebuild_search_access_path',
          payload: {
            trigger: 'schema_change',
            reason: input.reason,
            configKey: activeConfig.candidate_key,
            configScope: activeConfig.search_scope,
          },
          now: new Date(),
        })._unsafeUnwrap();
        const snapshot = task.snapshot();
        await sql`
          INSERT INTO table_query_remediation_task (
            id, base_id, table_id, kind, status, payload, attempts, max_attempts, created_time
          ) VALUES (
            ${snapshot.id},
            ${snapshot.baseId},
            ${snapshot.tableId},
            ${snapshot.kind},
            ${snapshot.status},
            ${JSON.stringify(snapshot.payload)}::jsonb,
            ${snapshot.attempts},
            ${snapshot.maxAttempts},
            ${snapshot.createdTime}
          )
        `.execute(trx);

        return {
          tableId,
          taskId: snapshot.id,
          status: 'queued' as const,
        };
      });

      return ok(scheduled);
    } catch (error) {
      return err(
        toInfrastructureError(error, 'Failed to schedule search vector schema maintenance')
      );
    }
  }
}
