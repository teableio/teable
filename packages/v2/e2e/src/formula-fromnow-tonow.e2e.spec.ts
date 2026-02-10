/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  expect(Number.isFinite(parsed)).toBe(true);
  return parsed;
};

describe('v2 http formula FROMNOW / TONOW (e2e)', () => {
  let ctx: SharedTestContext;
  const uniqueName = (prefix: string) =>
    `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  it('handles unit conversion and TONOW sign semantics', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('formula-fromnow-tonow'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'date', name: 'EventTime' },
      ],
      views: [{ type: 'grid' }],
    });

    const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    const dateFieldId = table.fields.find((f) => f.name === 'EventTime')?.id ?? '';

    let latestTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'FROMNOW_day',
        options: {
          expression: `FROMNOW({${dateFieldId}}, "day")`,
        },
      },
    });

    latestTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'FROMNOW_hour',
        options: {
          expression: `FROMNOW({${dateFieldId}}, "hour")`,
        },
      },
    });

    latestTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'FROMNOW_second',
        options: {
          expression: `FROMNOW({${dateFieldId}}, "second")`,
        },
      },
    });

    latestTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'TONOW_day',
        options: {
          expression: `TONOW({${dateFieldId}}, "day")`,
        },
      },
    });

    const fromNowDayId = latestTable.fields.find((f) => f.name === 'FROMNOW_day')?.id ?? '';
    const fromNowHourId = latestTable.fields.find((f) => f.name === 'FROMNOW_hour')?.id ?? '';
    const fromNowSecondId = latestTable.fields.find((f) => f.name === 'FROMNOW_second')?.id ?? '';
    const toNowDayId = latestTable.fields.find((f) => f.name === 'TONOW_day')?.id ?? '';

    const now = Date.now();
    const pastDate = new Date(now - (3 * 24 + 2) * 60 * 60 * 1000).toISOString();
    const futureDate = new Date(now + (2 * 24 + 1) * 60 * 60 * 1000).toISOString();

    await ctx.createRecord(table.id, {
      [primaryFieldId]: 'past',
      [dateFieldId]: pastDate,
    });

    await ctx.createRecord(table.id, {
      [primaryFieldId]: 'future',
      [dateFieldId]: futureDate,
    });

    await ctx.drainOutbox();

    const records = await ctx.listRecords(table.id);
    const pastRecord = records.find((record) => record.fields[primaryFieldId] === 'past');
    const futureRecord = records.find((record) => record.fields[primaryFieldId] === 'future');

    expect(pastRecord).toBeDefined();
    expect(futureRecord).toBeDefined();
    if (!pastRecord || !futureRecord) return;

    const pastFromDay = toNumber(pastRecord.fields[fromNowDayId]);
    const pastFromHour = toNumber(pastRecord.fields[fromNowHourId]);
    const pastFromSecond = toNumber(pastRecord.fields[fromNowSecondId]);
    const pastToDay = toNumber(pastRecord.fields[toNowDayId]);

    expect(pastFromDay).toBeGreaterThan(0);
    expect(pastToDay).toBeGreaterThan(0);
    expect(Math.abs(pastFromDay - pastToDay)).toBeLessThanOrEqual(1);

    expect(pastFromHour).toBeGreaterThanOrEqual(pastFromDay * 24);
    expect(pastFromHour).toBeLessThan((pastFromDay + 1) * 24);
    expect(pastFromSecond).toBeGreaterThanOrEqual(pastFromHour * 3600);
    expect(pastFromSecond).toBeLessThan((pastFromHour + 1) * 3600);

    const futureToDay = toNumber(futureRecord.fields[toNowDayId]);
    expect(futureToDay).toBeLessThan(0);
  });
});
