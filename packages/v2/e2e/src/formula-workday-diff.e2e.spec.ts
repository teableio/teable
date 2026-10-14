/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const toNumber = (value: unknown): number => {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
  const parsed = typeof value === 'number' ? value : Number(value);
  expect(Number.isFinite(parsed)).toBe(true);
  return parsed;
};

describe('[C08] v2 http formula WORKDAY_DIFF (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  it('includes both workday endpoints for same-day, weekend and reverse ranges', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Inclusive workdays',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'date',
          name: 'Start',
          options: { formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'utc' } },
        },
        {
          type: 'date',
          name: 'End',
          options: { formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'utc' } },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const nameId = table.fields.find((field) => field.isPrimary)!.id;
    const startId = table.fields.find((field) => field.name === 'Start')!.id;
    const endId = table.fields.find((field) => field.name === 'End')!.id;
    const formulas = [
      ['Workdays', `WORKDAY_DIFF({${startId}}, {${endId}})`],
      ['CalendarDays', `DATETIME_DIFF({${endId}}, {${startId}}, "day")`],
      [
        'WithHolidays',
        `WORKDAY_DIFF({${startId}}, {${endId}}, "2026-03-09,2026-03-09,2026-03-13,2026-03-14")`,
      ],
      ['OffsetCount', `WORKDAY_DIFF({${startId}}, WORKDAY({${startId}}, 5))`],
    ];
    const formulaIds: Record<string, string> = {};
    for (const [name, expression] of formulas) {
      const updated = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: { type: 'formula', name, options: { expression, timeZone: 'Asia/Singapore' } },
      });
      formulaIds[name] = updated.fields.find((field) => field.name === name)!.id;
    }

    const cases = [
      { name: 'OneWeek', start: '2026-03-09', end: '2026-03-13', expected: 5 },
      { name: 'TwoWeeks', start: '2026-03-09', end: '2026-03-20', expected: 10 },
      { name: 'ThreeWeeks', start: '2026-03-09', end: '2026-03-27', expected: 15 },
      { name: 'SameWeekday', start: '2026-03-09', end: '2026-03-09', expected: 1 },
      { name: 'SameWeekend', start: '2026-03-14', end: '2026-03-14', expected: 0 },
      { name: 'FridayToMonday', start: '2026-03-13', end: '2026-03-16', expected: 2 },
      { name: 'OnlyWeekend', start: '2026-03-14', end: '2026-03-15', expected: 0 },
      { name: 'MondayToMonday', start: '2026-03-09', end: '2026-03-16', expected: 6 },
      { name: 'ReverseWeek', start: '2026-03-13', end: '2026-03-09', expected: -5 },
    ];
    await ctx.createRecords(
      table.id,
      cases.map(({ name, start, end }) => ({
        fields: {
          [nameId]: name,
          [startId]: `${start}T00:00:00.000Z`,
          [endId]: `${end}T00:00:00.000Z`,
        },
      }))
    );
    await ctx.drainOutbox();
    const records = await ctx.listRecords(table.id);
    for (const testCase of cases) {
      const record = records.find((row) => row.fields[nameId] === testCase.name)!;
      expect(record, testCase.name).toBeDefined();
      expect(toNumber(record.fields[formulaIds.Workdays]), testCase.name).toBe(testCase.expected);
    }

    const oneWeek = records.find((row) => row.fields[nameId] === 'OneWeek')!;
    const sameDay = records.find((row) => row.fields[nameId] === 'SameWeekday')!;
    const reverse = records.find((row) => row.fields[nameId] === 'ReverseWeek')!;
    expect(toNumber(oneWeek.fields[formulaIds.CalendarDays])).toBe(4);
    expect(toNumber(oneWeek.fields[formulaIds.WithHolidays])).toBe(3);
    expect(toNumber(sameDay.fields[formulaIds.WithHolidays])).toBe(0);
    expect(toNumber(reverse.fields[formulaIds.WithHolidays])).toBe(-3);
    expect(toNumber(oneWeek.fields[formulaIds.OffsetCount])).toBe(6);

    await ctx.updateRecord(table.id, oneWeek.id, {
      [startId]: '2026-03-14T00:00:00.000Z',
      [endId]: '2026-03-16T00:00:00.000Z',
    });
    await ctx.drainOutbox();
    const updated = (await ctx.listRecords(table.id)).find((row) => row.id === oneWeek.id)!;
    expect(toNumber(updated.fields[formulaIds.Workdays])).toBe(1);
    expect(toNumber(updated.fields[formulaIds.WithHolidays])).toBe(1);
  });
});
