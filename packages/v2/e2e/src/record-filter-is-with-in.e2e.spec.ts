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
});
