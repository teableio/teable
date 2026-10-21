/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T7062: sanitized, structure-equivalent to production V2SchemaOperationFailure
 * BACKEND-CN-172 (Sentry issue 7701948259).
 *
 * Retained structural facts only:
 * - host table.update schema operation left error/pending for repair
 * - host still has a soft-deleted two-way oneMany link field
 * - that deleted field's fkHostTableName points at a foreign physical relation
 * - the foreign table metadata and physical relation are both gone
 *
 * Pre-fix, schema-operation repair loaded deleted children (`state: 'all'`)
 * and ensureInsertedMany ALTERed the missing fk host (`relation does not exist`),
 * then refused auto-repair because the error was not a missing column.
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

describe('v2 schema operation repair skips deleted oneMany fk hosts (T7062)', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  it(
    'repairs an interrupted table.update after a deleted oneMany link lost its fk host table',
    { timeout: 180_000 },
    async () => {
      let hostTableId: string | undefined;
      let foreignTableId: string | undefined;
      let operationId: string | undefined;

      const runRepair = async () => {
        const runner = ctx.testContainer.container.resolve<SchemaOperationRunnerService>(
          v2CoreTokens.schemaOperationRunnerService
        );
        const runnerContext: IExecutionContext = {
          actorId: ActorId.create('system')._unsafeUnwrap(),
          requestId: 'e2e-t7062-deleted-link-repair',
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
            workerId: 'e2e-t7062-deleted-link-repair',
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
            WHERE "id" = ${operationId!}
          `.execute(ctx.testContainer.db);
          settled = rows.rows.at(0);
        }
        return settled;
      };

      try {
        const foreignTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('T7062 Foreign'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        });
        foreignTableId = foreignTable.id;
        const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
        if (!foreignPrimaryFieldId) {
          throw new Error('Missing foreign primary field');
        }

        const hostTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('T7062 Host'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'link',
              name: 'Related',
              options: {
                relationship: 'oneMany',
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignPrimaryFieldId,
                isOneWay: false,
              },
            },
          ],
        });
        hostTableId = hostTable.id;
        const relatedField = hostTable.fields.find((field) => field.name === 'Related');
        if (!relatedField) {
          throw new Error('Missing host related field');
        }

        const linkOptions = await sql<{ fk_host: string | null }>`
          SELECT options::jsonb->>'fkHostTableName' as "fk_host"
          FROM "field"
          WHERE "id" = ${relatedField.id}
        `.execute(ctx.testContainer.db);
        const fkHostTableName = linkOptions.rows.at(0)?.fk_host;
        expect(fkHostTableName).toEqual(`${ctx.baseId}.${foreignTable.id}`);

        await ctx.deleteField({ tableId: hostTable.id, fieldId: relatedField.id });
        await ctx.deleteTable(foreignTable.id, { mode: 'permanent' });
        foreignTableId = undefined;
        await ctx.drainOutbox();

        const deletedLink = await sql<{
          deleted_time: Date | null;
          fk_host: string | null;
        }>`
          SELECT "deleted_time", options::jsonb->>'fkHostTableName' as "fk_host"
          FROM "field"
          WHERE "id" = ${relatedField.id}
        `.execute(ctx.testContainer.db);
        expect(deletedLink.rows.at(0)?.deleted_time).toBeTruthy();
        expect(deletedLink.rows.at(0)?.fk_host).toBe(fkHostTableName);

        const relationExists = await sql<{ exists: boolean }>`
          SELECT EXISTS (
            SELECT 1
            FROM pg_class c
            INNER JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ${ctx.baseId}
              AND c.relname = ${foreignTable.id}
          ) as "exists"
        `.execute(ctx.testContainer.db);
        expect(relationExists.rows.at(0)?.exists).toBe(false);

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
            ${hostTable.id},
            ${ctx.baseId},
            ${hostTable.id},
            ${`${operationId}:table:${hostTable.id}`},
            ${JSON.stringify({ tableId: hostTable.id })}::jsonb,
            ${0},
            ${8},
            ${now},
            ${null},
            ${now},
            ${'usrT7062repairxxxx'}
          )
        `.execute(ctx.testContainer.db);

        const settled = await runRepair();
        expect(settled).toMatchObject({
          status: 'ready',
          phase: 'ready',
          last_error: null,
        });
        expect(settled?.result).toMatchObject({
          repaired: 'table_schema',
          tableIds: [hostTable.id],
        });
      } finally {
        await ctx.drainOutbox().catch(() => undefined);
        if (hostTableId) {
          await ctx.deleteTable(hostTableId, { mode: 'permanent' }).catch(() => undefined);
        }
        if (foreignTableId) {
          await ctx.deleteTable(foreignTableId, { mode: 'permanent' }).catch(() => undefined);
        }
      }
    }
  );
});
