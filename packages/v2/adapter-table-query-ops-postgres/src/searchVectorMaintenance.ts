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

type SearchVectorConfigRow = {
  readonly id: string;
};

type QueuedTaskRow = {
  readonly id: string;
};

export class PostgresTableSearchVectorSchemaMaintenanceScheduler
  implements TableSearchVectorSchemaMaintenanceScheduler
{
  constructor(private readonly metaDb: Kysely<UnknownPostgresDatabase>) {}

  async schedule(
    _context: IExecutionContext,
    input: Parameters<TableSearchVectorSchemaMaintenanceScheduler['schedule']>[1]
  ): Promise<Result<TableSearchVectorSchemaMaintenanceSchedule | undefined, DomainError>> {
    const tableId = input.table.id().toString();
    const baseId = input.table.baseId().toString();

    try {
      const scheduled = await this.metaDb.transaction().execute(async (trx) => {
        await sql`
          SELECT pg_advisory_xact_lock(
            hashtext('teable.table_query_ops.search_vector_maintenance'),
            hashtext(${tableId}::text)
          )
        `.execute(trx);

        const config = await sql<SearchVectorConfigRow>`
          SELECT id
          FROM table_query_search_vector_config
          WHERE table_id = ${tableId}
            AND status IN ('ready', 'stale', 'rebuild_pending')
          ORDER BY last_modified_time DESC NULLS LAST, created_time DESC
          LIMIT 1
        `.execute(trx);
        const activeConfig = config.rows[0];
        if (!activeConfig) return undefined;

        await sql`
          UPDATE table_query_search_vector_config
          SET status = 'rebuild_pending',
              last_inspection = jsonb_build_object(
                'state', 'rebuild_pending',
                'reason', ${input.reason}::text
              ),
              last_modified_time = now()
          WHERE id = ${activeConfig.id}
        `.execute(trx);

        const queued = await sql<QueuedTaskRow>`
          SELECT id
          FROM table_query_remediation_task
          WHERE table_id = ${tableId}
            AND kind IN ('rebuild_search_access_path', 'rebuild_search_vector')
            AND status = 'queued'
            AND payload ->> 'trigger' = 'schema_change'
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
          payload: { trigger: 'schema_change', reason: input.reason },
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
