/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T7114: sanitized, structure-equivalent to the app.teable.ai incident where
 * creating a formula field left table.update pending and hid the table from
 * metadata until schema-op repair.
 *
 * Retained structural facts only:
 * - zero-record table with a numeric formula chain
 * - table.update schema operation payload is begin-only `{ tableId }`
 * - lastError is empty (request aborted after begin, before fail/complete)
 * - provision_state=pending hides the table from get/list
 *
 * Customer names, ids, values, and business terminology are not copied.
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

describe('v2 formula create leftover pending does not hide table (T7114)', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  it(
    'keeps a formula-chain table listable after each createField and restores leftover pending',
    { timeout: 180_000 },
    async () => {
      let tableId: string | undefined;
      let operationId: string | undefined;

      const assertTableVisible = async () => {
        const table = await ctx.getTableById(tableId!);
        expect(table.id).toBe(tableId);
        const listed = await ctx.listTables({ baseId: ctx.baseId, limit: 100 });
        expect(listed.some((item) => item.id === tableId)).toBe(true);
        return table;
      };

      try {
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('T7114 Formula Host'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Quantity' },
            { type: 'number', name: 'Unit Amount' },
          ],
        });
        tableId = table.id;
        const quantityFieldId = table.fields.find((field) => field.name === 'Quantity')?.id;
        const unitAmountFieldId = table.fields.find((field) => field.name === 'Unit Amount')?.id;
        if (!quantityFieldId || !unitAmountFieldId) {
          throw new Error('Missing source number fields');
        }

        const afterRevenue = await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Gross Amount',
            options: {
              expression: `IF(OR({${quantityFieldId}}=BLANK(),{${unitAmountFieldId}}=BLANK(),{${quantityFieldId}}<=0),BLANK(),{${quantityFieldId}}*{${unitAmountFieldId}})`,
            },
          },
        });
        const revenueFieldId = afterRevenue.fields.find(
          (field) => field.name === 'Gross Amount'
        )?.id;
        if (!revenueFieldId) {
          throw new Error('Missing Gross Amount field');
        }
        await assertTableVisible();

        const afterCost = await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Total Cost',
            options: {
              expression: `IF(OR({${quantityFieldId}}=BLANK(),{${unitAmountFieldId}}=BLANK(),{${quantityFieldId}}<0),BLANK(),{${quantityFieldId}}*{${unitAmountFieldId}})`,
            },
          },
        });
        const costFieldId = afterCost.fields.find((field) => field.name === 'Total Cost')?.id;
        if (!costFieldId) {
          throw new Error('Missing Total Cost field');
        }
        await assertTableVisible();

        const afterProvision = await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Amount After Cost',
            options: {
              expression: `IF(OR({${revenueFieldId}}=BLANK(),{${costFieldId}}=BLANK(),{${costFieldId}}<0),BLANK(),{${revenueFieldId}}-{${costFieldId}})`,
            },
          },
        });
        const visible = await assertTableVisible();
        expect(visible.fields.some((field) => field.name === 'Amount After Cost')).toBe(true);
        expect(afterProvision.fields.some((field) => field.name === 'Amount After Cost')).toBe(
          true
        );
        const fieldCountBeforeLeftover = visible.fields.length;

        await sql`
          UPDATE "table_meta"
          SET "provision_state" = ${'pending'}
          WHERE "id" = ${table.id}
        `.execute(ctx.testContainer.db);

        operationId = `sgo${Date.now().toString(16).padStart(16, '0').slice(-16)}`;
        const now = new Date(Date.now() - 6 * 60 * 1000);
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
            "created_by",
            "last_modified_time"
          )
          VALUES (
            ${operationId},
            ${'table.update'},
            ${'pending'},
            ${'metadata_pending'},
            ${'table'},
            ${table.id},
            ${ctx.baseId},
            ${table.id},
            ${`${operationId}:table:${table.id}`},
            ${JSON.stringify({ tableId: table.id })}::jsonb,
            ${0},
            ${8},
            ${now},
            ${null},
            ${now},
            ${'usrT7114pendingxxxx'},
            ${now}
          )
        `.execute(ctx.testContainer.db);

        await expect(ctx.getTableById(table.id)).rejects.toThrow();

        const runner = ctx.testContainer.container.resolve<SchemaOperationRunnerService>(
          v2CoreTokens.schemaOperationRunnerService
        );
        const runnerContext: IExecutionContext = {
          actorId: ActorId.create('system')._unsafeUnwrap(),
          requestId: 'e2e-t7114-formula-pending',
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
            workerId: 'e2e-t7114-formula-pending',
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
          repaired: 'table_schema',
          tableIds: [table.id],
        });

        const restored = await assertTableVisible();
        expect(restored.fields).toHaveLength(fieldCountBeforeLeftover);
        expect(restored.fields.some((field) => field.name === 'Margin Percent')).toBe(false);
      } finally {
        if (tableId) {
          await ctx.deleteTable(tableId, { mode: 'permanent' }).catch(() => undefined);
        }
      }
    }
  );
});
