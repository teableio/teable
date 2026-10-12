import { setTimeout as delay } from 'node:timers/promises';
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const createFieldId = () => `fld${getRandomString(16)}`;

describe('computed conditional lookup return chain (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    // Keep the default hybrid policy and stage budgets; only dispatch is external.
    ctx = await getSharedTestContext();
  });

  it('refreshes linked and unlinked details after a manyMany rollup changes remaining T7458', async () => {
    const detailKeyId = createFieldId();
    const amountId = createFieldId();
    const summaryKeyId = createFieldId();
    const totalId = createFieldId();
    const linkId = createFieldId();
    const rollupId = createFieldId();
    const remainingId = createFieldId();
    const downstreamId = createFieldId();
    const lookupId = createFieldId();
    const detailCount = 2000;

    const detail = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Return chain details',
      fields: [
        { type: 'singleLineText', id: detailKeyId, name: 'Key', isPrimary: true },
        { type: 'number', id: amountId, name: 'Amount' },
      ],
    });
    const detailIds: string[] = [];
    for (let offset = 0; offset < detailCount; offset += 500) {
      const records = await ctx.createRecords(
        detail.id,
        Array.from({ length: 500 }, () => ({
          fields: { [detailKeyId]: 'Group A', [amountId]: 0 },
        }))
      );
      detailIds.push(...records.map((record) => record.id));
    }

    const summary = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Return chain summary',
      fields: [
        { type: 'singleLineText', id: summaryKeyId, name: 'Key', isPrimary: true },
        { type: 'number', id: totalId, name: 'Total' },
        {
          type: 'link',
          id: linkId,
          name: 'Details',
          options: {
            relationship: 'manyMany',
            foreignTableId: detail.id,
            lookupFieldId: detailKeyId,
          },
        },
        {
          type: 'rollup',
          id: rollupId,
          name: 'Used',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId: linkId,
            foreignTableId: detail.id,
            lookupFieldId: amountId,
          },
        },
        {
          type: 'formula',
          id: remainingId,
          name: 'Remaining',
          options: { expression: `{${totalId}} - {${rollupId}}` },
        },
        {
          type: 'formula',
          id: downstreamId,
          name: 'Remaining downstream',
          options: { expression: `{${remainingId}} + 0` },
        },
      ],
    });
    const summaryRecord = await ctx.createRecord(summary.id, {
      [summaryKeyId]: 'Group A',
      [totalId]: 200,
      [linkId]: detailIds.slice(0, 3).map((id) => ({ id })),
    });
    await ctx.drainOutbox();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: detail.id,
      field: {
        type: 'conditionalLookup',
        id: lookupId,
        name: 'Remaining by key',
        options: {
          foreignTableId: summary.id,
          lookupFieldId: remainingId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: summaryKeyId,
                  operator: 'is',
                  value: detailKeyId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      },
    });

    const assertRemaining = async (expected: number) => {
      // A zero processed count alone can leave a delayed continuation pending.
      let settled = false;
      for (let round = 0; round < 120; round += 1) {
        const processed = await ctx.testContainer.processOutboxOnce();
        const pending = await sql<{ count: number }>`
          SELECT count(*)::int AS count FROM computed_update_outbox
          WHERE base_id = ${ctx.baseId} AND status IN ('pending', 'processing')
        `.execute(ctx.testContainer.db);
        if (pending.rows[0].count === 0) {
          settled = true;
          break;
        }
        if (processed === 0) await delay(200);
      }
      expect(settled, 'Outbox must settle before checking stored results').toBe(true);
      const dead = await sql<{ count: number }>`
        SELECT count(*)::int AS count FROM computed_update_dead_letter
        WHERE base_id = ${ctx.baseId}
      `.execute(ctx.testContainer.db);
      expect(dead.rows[0].count, 'No failed computed work').toBe(0);

      const summaries = await ctx.listRecordsWithoutDrain(summary.id);
      const row = summaries.find((record) => record.id === summaryRecord.id);
      expect(row?.fields[rollupId]).toBe(200 - expected);
      expect(row?.fields[remainingId]).toBe(expected);
      expect(row?.fields[downstreamId]).toBe(expected);

      // Check both pages: only three rows are linked, but all 2000 match the key.
      const seenIds = new Set<string>();
      for (let offset = 0; offset < detailCount; offset += 1000) {
        const records = await ctx.listRecordsWithoutDrain(detail.id, { limit: 1000, offset });
        for (const record of records) {
          seenIds.add(record.id);
          expect(record.fields[lookupId], `Remaining on detail ${record.id}`).toEqual([expected]);
        }
      }
      expect(seenIds).toEqual(new Set(detailIds));
    };

    await assertRemaining(200);
    const amounts = [5, 2, 3];
    const expectedRemaining = [195, 193, 190];
    for (let index = 0; index < amounts.length; index += 1) {
      await ctx.updateRecord(detail.id, detailIds[index], { [amountId]: amounts[index] });
      await assertRemaining(expectedRemaining[index]);
    }
  }, 120_000);
});
