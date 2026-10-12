/* eslint-disable @typescript-eslint/naming-convention */
import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { createV2HttpClient, type V2HttpClient } from '@teable/v2-contract-http-client';
import { FieldKeyType } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * T7404 — a field's display formatting must not decide the row order of a view.
 *
 * Reported case: a Created time (and any date) field whose formatting hides the
 * hour/minute (`time: 'None'`). Rows must still be ordered by the stored
 * timestamp, whether the sort comes from the request or from the saved view.
 * Number fields must follow the stored value even when decimals are hidden
 * (`precision: 0`).
 *
 * Grouping keeps the formatting granularity: grouped reads still order and
 * bucket rows by the display-day bucket, so a display day stays one group and
 * nested (day, stage) blocks stay contiguous.
 *
 * Rows are inserted in an order unrelated to their value order, so a
 * formatting-based comparison cannot hide behind the view-row tie-breaker.
 */
describe('v2 listRecords sort ignores field formatting (e2e)', () => {
  let ctx: SharedTestContext;
  let client: V2HttpClient;

  const listRecords = async (
    tableId: string,
    options: {
      sort?: Array<{ fieldId: string; order: 'asc' | 'desc' }>;
      groupBy?: string[];
      includeGroups?: boolean;
      viewId?: string;
    } = {}
  ) => {
    const params = new URLSearchParams({ tableId, fieldKeyType: FieldKeyType.Id });
    if (options.sort) params.set('sort', JSON.stringify(options.sort));
    if (options.groupBy) params.set('groupBy', JSON.stringify(options.groupBy));
    if (options.includeGroups) params.set('includeGroups', 'true');
    if (options.viewId) params.set('viewId', options.viewId);

    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`ListRecords failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`ListRecords response invalid: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    client = createV2HttpClient({ baseUrl: ctx.baseUrl });
  }, 60000);

  describe('a date field that hides the time', () => {
    let tableId: string;
    let nameFieldId: string;
    let dateFieldId: string;
    let amountFieldId: string;
    let stageFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort Format Date',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'When',
            type: 'date',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'Asia/Shanghai' },
            },
          },
          {
            name: 'Amount',
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 0 } },
          },
          {
            name: 'Stage',
            type: 'singleSelect',
            options: {
              choices: [
                { id: 'choice-a', name: 'a', color: 'blue' },
                { id: 'choice-b', name: 'b', color: 'green' },
              ],
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      dateFieldId = table.fields.find((f) => f.name === 'When')?.id ?? '';
      amountFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';
      stageFieldId = table.fields.find((f) => f.name === 'Stage')?.id ?? '';

      await ctx.createRecords(tableId, [
        {
          fields: {
            [nameFieldId]: 'same-day-early',
            [stageFieldId]: 'b',
            [dateFieldId]: '2026-05-06T01:00:00.000Z',
            [amountFieldId]: 1.2,
          },
        },
        {
          fields: {
            [nameFieldId]: 'same-day-late',
            [stageFieldId]: 'a',
            [dateFieldId]: '2026-05-06T09:00:00.000Z',
            [amountFieldId]: 1.4,
          },
        },
        {
          // Asia/Shanghai 2026-05-06 02:00 — the same display day as the two
          // rows above, but the previous UTC day.
          fields: {
            [nameFieldId]: 'prev-day-evening',
            [stageFieldId]: 'a',
            [dateFieldId]: '2026-05-05T18:00:00.000Z',
            [amountFieldId]: 5,
          },
        },
        {
          fields: {
            [nameFieldId]: 'previous-day',
            [stageFieldId]: 'b',
            [dateFieldId]: '2026-05-05T01:00:00.000Z',
            [amountFieldId]: 9,
          },
        },
      ]);
    }, 120000);

    it('orders by the stored timestamp instead of the displayed date', async () => {
      const { records } = await listRecords(tableId, {
        sort: [{ fieldId: dateFieldId, order: 'desc' }],
      });

      expect(records.map((record) => record.fields[nameFieldId])).toEqual([
        'same-day-late',
        'same-day-early',
        'prev-day-evening',
        'previous-day',
      ]);
    });

    it('orders by the stored number instead of the rounded display value', async () => {
      const { records } = await listRecords(tableId, {
        sort: [{ fieldId: amountFieldId, order: 'desc' }],
      });

      expect(records.map((record) => record.fields[nameFieldId])).toEqual([
        'previous-day',
        'prev-day-evening',
        'same-day-late',
        'same-day-early',
      ]);
    });

    it('keeps grouping on the formatted local day bucket', async () => {
      const { records, groups } = await listRecords(tableId, {
        groupBy: [dateFieldId],
        sort: [{ fieldId: dateFieldId, order: 'desc' }],
        includeGroups: true,
      });

      // The three rows that share the Asia/Shanghai display day 2026-05-06 must
      // collapse into one bucket of 3. The bucket stays the leading order key,
      // so rows inside it fall back to the view row order tie-breaker.
      expect(groups?.map((group) => group.count)).toEqual([3, 1]);
      expect(records.map((record) => record.fields[nameFieldId])).toEqual([
        'same-day-early',
        'same-day-late',
        'prev-day-evening',
        'previous-day',
      ]);
    });

    it('keeps nested group blocks contiguous on the formatted day bucket', async () => {
      const { records } = await listRecords(tableId, {
        groupBy: [dateFieldId, stageFieldId],
        sort: [
          { fieldId: dateFieldId, order: 'asc' },
          { fieldId: stageFieldId, order: 'asc' },
        ],
      });

      // Grouping by display day and then by Stage has to keep every
      // (day, stage) block contiguous. The Asia/Shanghai 2026-05-06 bucket
      // holds 'same-day-late' (a), 'prev-day-evening' (a) and 'same-day-early'
      // (b); ordering that bucket by raw timestamp first would put
      // 'prev-day-evening', 'same-day-early', 'same-day-late' — a, b, a — and
      // split the stage-a block around the stage-b row.
      expect(records.map((record) => record.fields[nameFieldId])).toEqual([
        'previous-day',
        'same-day-late',
        'prev-day-evening',
        'same-day-early',
      ]);
    });
  });

  describe('a saved view sort on a date field that hides the time', () => {
    let tableId: string;
    let viewId: string;
    let nameFieldId: string;
    let dateFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort Format View',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'When',
            type: 'date',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'Asia/Shanghai' },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      viewId = table.views[0].id;
      nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      dateFieldId = table.fields.find((f) => f.name === 'When')?.id ?? '';

      await ctx.createRecords(tableId, [
        { fields: { [nameFieldId]: 'view-early', [dateFieldId]: '2026-05-06T01:00:00.000Z' } },
        { fields: { [nameFieldId]: 'view-late', [dateFieldId]: '2026-05-06T09:00:00.000Z' } },
        { fields: { [nameFieldId]: 'view-previous', [dateFieldId]: '2026-05-05T01:00:00.000Z' } },
      ]);

      const saved = await client.tables.updateViewSort({
        tableId,
        viewId,
        sort: { sortObjs: [{ fieldId: dateFieldId, order: 'desc' }], manualSort: false },
      });
      expect(saved.ok).toBe(true);
    }, 120000);

    it('orders the view rows by the stored timestamp', async () => {
      const { records } = await listRecords(tableId, { viewId });

      expect(records.map((record) => record.fields[nameFieldId])).toEqual([
        'view-late',
        'view-early',
        'view-previous',
      ]);
    });
  });

  describe('the reported Created time field', () => {
    let tableId: string;
    let nameFieldId: string;
    let createdTimeFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort Format Created Time',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Created At',
            type: 'createdTime',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'Asia/Shanghai' },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      createdTimeFieldId = table.fields.find((f) => f.name === 'Created At')?.id ?? '';
      expect(createdTimeFieldId).not.toBe('');

      const records = await ctx.createRecords(tableId, [
        { fields: { [nameFieldId]: 'ct-a' } },
        { fields: { [nameFieldId]: 'ct-b' } },
        { fields: { [nameFieldId]: 'ct-c' } },
      ]);

      const tableMeta = await ctx.testContainer.db
        .selectFrom('table_meta')
        .select('db_table_name')
        .where('id', '=', tableId)
        .executeTakeFirst();
      const dbTableName = tableMeta?.db_table_name;
      if (!dbTableName) {
        throw new Error(`Failed to resolve db_table_name for table ${tableId}`);
      }

      // ct-a and ct-b are the same display day with different hours; ct-c is the
      // previous day. Insertion order (row order) stays ct-a, ct-b, ct-c.
      const createdTimes: Array<[string | undefined, string]> = [
        [records[0]?.id, '2026-05-06T01:00:00.000Z'],
        [records[1]?.id, '2026-05-06T09:00:00.000Z'],
        [records[2]?.id, '2026-05-05T01:00:00.000Z'],
      ];
      for (const [recordId, time] of createdTimes) {
        await sql`
          UPDATE ${sql.table(dbTableName)}
          SET ${sql.ref('__created_time')} = ${time}
          WHERE "__id" = ${recordId}
        `.execute(ctx.testContainer.db);
      }
    }, 120000);

    it('orders by the stored timestamp when the time display is off', async () => {
      const { records } = await listRecords(tableId, {
        sort: [{ fieldId: createdTimeFieldId, order: 'desc' }],
      });

      expect(records.map((record) => record.fields[nameFieldId])).toEqual(['ct-b', 'ct-a', 'ct-c']);
    });
  });
});
