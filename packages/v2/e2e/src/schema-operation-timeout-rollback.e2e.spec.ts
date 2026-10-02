/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T7104: sanitized, structure-equivalent to production V2SchemaOperationFailure
 * BACKEND-AI-1JX (Sentry issue 7706449080).
 *
 * Retained structural facts only:
 * - table.update schema operation left in error after a unit-of-work failure
 * - lastError is a connection timeout, not a missing-column SQLSTATE
 * - payload is null because the begin write rolled back with the parent transaction
 * - result.tableUpdateFailure.code is `unexpected`
 *
 * Pre-fix, the repair gate treated any non-missing-column table.update as
 * `schema_operation.repair_not_supported` and marked the operation dead.
 * Customer names, ids, and values are not copied.
 */
import {
  ActorId,
  v2CoreTokens,
  type IExecutionContext,
  type SchemaOperationRunnerService,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 schema operation timeout settles as rollback (T7104)', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  it(
    'settles a payload-less table.update connection timeout as a rolled-back no-op',
    { timeout: 180_000 },
    async () => {
      let tableId: string | undefined;
      let operationId: string | undefined;

      try {
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('T7104 Timeout Host'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        });
        tableId = table.id;

        operationId = `sgo${Date.now().toString(16).padStart(16, '0').slice(-16)}`;
        const now = new Date();
        await sql`
          INSERT INTO "schema_operation" (
            "id",
            "type",
            "status",
            "phase",
            "resource_type",
            "resource_id",
            "base_id",
            "table_id",
            "idempotency_key",
            "payload",
            "result",
            "attempts",
            "max_attempts",
            "next_run_at",
            "last_error",
            "created_time",
            "created_by"
          )
          VALUES (
            ${operationId},
            ${'table.update'},
            ${'error'},
            ${'error'},
            ${'table'},
            ${table.id},
            ${ctx.baseId},
            ${table.id},
            ${`${operationId}:table:${table.id}`},
            ${null},
            ${JSON.stringify({ tableUpdateFailure: { code: 'unexpected' } })}::jsonb,
            ${1},
            ${8},
            ${now},
            ${'Unexpected unit of work error: Error: Connection terminated due to connection timeout'},
            ${now},
            ${'usrT7104timeoutxxxx'}
          )
        `.execute(ctx.testContainer.db);

        const runner = ctx.testContainer.container.resolve<SchemaOperationRunnerService>(
          v2CoreTokens.schemaOperationRunnerService
        );
        const runnerContext: IExecutionContext = {
          actorId: ActorId.create('system')._unsafeUnwrap(),
          requestId: 'e2e-t7104-timeout-rollback',
        };
        const claimNow = new Date(Date.now() + 3_600_000);
        let settled:
          | {
              id: string;
              status: string;
              phase: string;
              last_error: string | null;
              result: unknown;
            }
          | undefined;
        for (let run = 0; run < 20; run += 1) {
          if (settled?.status === 'ready' || settled?.status === 'dead') {
            break;
          }
          await runner.runNext(runnerContext, {
            workerId: 'e2e-t7104-timeout-rollback',
            now: claimNow,
            staleRunningBefore: new Date(Date.now() - 60_000),
          });
          const rows = await sql<{
            id: string;
            status: string;
            phase: string;
            last_error: string | null;
            result: unknown;
          }>`
            SELECT "id", "status", "phase", "last_error", "result"
            FROM "schema_operation"
            WHERE "id" = ${operationId}
          `.execute(ctx.testContainer.db);
          settled = rows.rows.at(0);
        }

        expect(settled).toMatchObject({
          status: 'ready',
          phase: 'ready',
          last_error: null,
        });
        expect(settled?.result).toMatchObject({
          repaired: 'transaction_rollback',
          tableIds: [table.id],
        });
      } finally {
        if (tableId) {
          await ctx.deleteTable(tableId, { mode: 'permanent' }).catch(() => undefined);
        }
      }
    }
  );
});
