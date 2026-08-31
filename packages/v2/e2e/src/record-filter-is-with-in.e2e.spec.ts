import type { RecordFilter } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('record filter isWithIn (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  describe('today mode', () => {
    let tableId: string;
    let viewId: string;
    let nameFieldId: string;
    let startTimeFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'IsWithIn Today Filter',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Start Time', type: 'date' },
        ],
        views: [{ type: 'grid' }],
      });

      tableId = table.id;
      viewId = table.views[0].id;
      nameFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
      startTimeFieldId = table.fields.find((field) => field.name === 'Start Time')?.id ?? '';

      const now = new Date();
      const today = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0, 0)
      );
      const yesterday = new Date(today);
      yesterday.setUTCDate(today.getUTCDate() - 1);
      const tomorrow = new Date(today);
      tomorrow.setUTCDate(today.getUTCDate() + 1);

      for (const [name, startTime] of [
        ['Yesterday', yesterday.toISOString()],
        ['Today', today.toISOString()],
        ['Tomorrow', tomorrow.toISOString()],
      ] as const) {
        await ctx.createRecord(tableId, {
          [nameFieldId]: name,
          [startTimeFieldId]: startTime,
        });
      }
    }, 30000);

    afterAll(async () => {
      if (tableId) {
        await ctx.deleteTable(tableId, { mode: 'permanent' });
      }
    });

    it('applies isWithIn today filter to the current day only', async () => {
      const filter: RecordFilter = {
        fieldId: startTimeFieldId,
        operator: 'isWithIn',
        value: {
          mode: 'today',
          timeZone: 'UTC',
        },
      };

      const result = await ctx.paste({
        tableId,
        viewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['Updated Today']],
        filter,
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(tableId);
      const todayRecord = records.find((record) => record.fields[nameFieldId] === 'Updated Today');
      const yesterdayRecord = records.find((record) => record.fields[nameFieldId] === 'Yesterday');
      const tomorrowRecord = records.find((record) => record.fields[nameFieldId] === 'Tomorrow');

      expect(todayRecord).toBeDefined();
      expect(todayRecord?.fields[startTimeFieldId]).toBeTruthy();
      expect(yesterdayRecord).toBeDefined();
      expect(tomorrowRecord).toBeDefined();
    });
  });

  describe('dateRange mode (v1 record-filter-query.e2e-spec:160)', () => {
    let tableId: string;
    let nameFieldId: string;
    let dateFieldId: string;
    let dateTimeFieldId: string;

    const listRecordsWithFilter = async (filter: unknown) => {
      const params = new URLSearchParams({
        tableId,
        fieldKeyType: 'id',
        filter: JSON.stringify(filter),
      });
      const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
        method: 'GET',
        headers: { 'content-type': 'application/json' },
      });
      const rawBody = (await response.json()) as {
        ok: boolean;
        data?: { records: Array<{ id: string; fields: Record<string, unknown> }> };
      };
      expect(response.status).toBe(200);
      if (!rawBody.ok || !rawBody.data) throw new Error('listRecords failed');
      return rawBody.data.records;
    };

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DateRange Filter Mode',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Due', type: 'date' },
          {
            name: 'Due At',
            type: 'date',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      nameFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
      dateFieldId = table.fields.find((field) => field.name === 'Due')?.id ?? '';
      dateTimeFieldId = table.fields.find((field) => field.name === 'Due At')?.id ?? '';

      for (const [name, due, dueAt] of [
        ['Before', '2024-05-20T12:00:00.000Z', '2024-06-15T08:00:00.000Z'],
        ['InRange1', '2024-06-05T12:00:00.000Z', '2024-06-15T09:00:00.000Z'],
        ['InRange2', '2024-06-20T12:00:00.000Z', '2024-06-15T17:00:00.000Z'],
        ['After', '2024-07-10T12:00:00.000Z', '2024-06-15T18:00:00.000Z'],
      ] as const) {
        await ctx.createRecord(tableId, {
          [nameFieldId]: name,
          [dateFieldId]: due,
          [dateTimeFieldId]: dueAt,
        });
      }
    }, 30000);

    afterAll(async () => {
      if (tableId) {
        await ctx.deleteTable(tableId, { mode: 'permanent' });
      }
    });

    it('filters records with a valid dateRange value', async () => {
      const records = await listRecordsWithFilter({
        fieldId: dateFieldId,
        operator: 'is',
        value: {
          mode: 'dateRange',
          exactDate: '2024-06-01T00:00:00.000Z',
          exactDateEnd: '2024-06-30T00:00:00.000Z',
          timeZone: 'UTC',
        },
      });
      expect(records.map((record) => record.fields[nameFieldId]).sort()).toEqual([
        'InRange1',
        'InRange2',
      ]);
    });

    it('respects the timeZone when computing dateRange day bounds', async () => {
      // In UTC+14 the range [2024-06-01, 2024-06-20] ends at 2024-06-20T09:59:59Z,
      // so InRange2 (2024-06-20T12:00Z) falls outside it.
      const records = await listRecordsWithFilter({
        fieldId: dateFieldId,
        operator: 'is',
        value: {
          mode: 'dateRange',
          exactDate: '2024-06-01T00:00:00.000Z',
          exactDateEnd: '2024-06-20T00:00:00.000Z',
          timeZone: 'Pacific/Kiritimati',
        },
      });
      expect(records.map((record) => record.fields[nameFieldId])).toEqual(['InRange1']);
    });

    it('preserves time bounds when the date field includes time formatting', async () => {
      const records = await listRecordsWithFilter({
        fieldId: dateTimeFieldId,
        operator: 'is',
        value: {
          mode: 'dateRange',
          exactDate: '2024-06-15T09:00:00.000Z',
          exactDateEnd: '2024-06-15T17:00:00.000Z',
          timeZone: 'UTC',
        },
      });
      expect(records.map((record) => record.fields[nameFieldId]).sort()).toEqual([
        'InRange1',
        'InRange2',
      ]);
    });

    it('skips a dateRange filter whose start is after its end', async () => {
      const records = await listRecordsWithFilter({
        fieldId: dateFieldId,
        operator: 'is',
        value: {
          mode: 'dateRange',
          exactDate: '2024-06-30T00:00:00.000Z',
          exactDateEnd: '2024-06-01T00:00:00.000Z',
          timeZone: 'Asia/Shanghai',
        },
      });
      // v1 contract: the invalid filter is dropped and the query still returns all rows
      expect(records.length).toBe(4);
    });

    it('skips a dateRange filter used with the isNot operator', async () => {
      const records = await listRecordsWithFilter({
        fieldId: dateFieldId,
        operator: 'isNot',
        value: {
          mode: 'dateRange',
          exactDate: '2024-06-01T00:00:00.000Z',
          exactDateEnd: '2024-06-30T00:00:00.000Z',
          timeZone: 'Asia/Shanghai',
        },
      });
      expect(records.length).toBe(4);
    });
  });
});
