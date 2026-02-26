/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  expect(Number.isFinite(parsed)).toBe(true);
  return parsed;
};

describe('v2 http formula WORKDAY_DIFF (e2e)', () => {
  let ctx: SharedTestContext;

  const uniqueName = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  it('excludes weekends, supports holiday list, and differs from DATETIME_DIFF across weekends', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('formula-workday-diff'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'date', name: 'StartDate' },
        { type: 'date', name: 'EndDate' },
      ],
      views: [{ type: 'grid' }],
    });

    const nameFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    const startDateFieldId = table.fields.find((field) => field.name === 'StartDate')?.id ?? '';
    const endDateFieldId = table.fields.find((field) => field.name === 'EndDate')?.id ?? '';

    let latestTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'CalendarDiff',
        options: {
          expression: `DATETIME_DIFF({${endDateFieldId}}, {${startDateFieldId}}, "day")`,
          timeZone: 'utc',
        },
      },
    });

    latestTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'WorkdayDiff',
        options: {
          expression: `WORKDAY_DIFF({${startDateFieldId}}, {${endDateFieldId}})`,
          timeZone: 'utc',
        },
      },
    });

    latestTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'WorkdayDiffHoliday',
        options: {
          expression: `WORKDAY_DIFF({${startDateFieldId}}, {${endDateFieldId}}, "2026-02-24")`,
          timeZone: 'utc',
        },
      },
    });

    latestTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'WorkdayInverse',
        options: {
          expression: `WORKDAY_DIFF({${startDateFieldId}}, WORKDAY({${startDateFieldId}}, 5))`,
          timeZone: 'utc',
        },
      },
    });

    const calendarDiffFieldId = latestTable.fields.find(
      (field) => field.name === 'CalendarDiff'
    )?.id;
    const workdayDiffFieldId = latestTable.fields.find((field) => field.name === 'WorkdayDiff')?.id;
    const workdayDiffHolidayFieldId = latestTable.fields.find(
      (field) => field.name === 'WorkdayDiffHoliday'
    )?.id;
    const workdayInverseFieldId = latestTable.fields.find(
      (field) => field.name === 'WorkdayInverse'
    )?.id;

    expect(calendarDiffFieldId).toBeTruthy();
    expect(workdayDiffFieldId).toBeTruthy();
    expect(workdayDiffHolidayFieldId).toBeTruthy();
    expect(workdayInverseFieldId).toBeTruthy();
    if (
      !calendarDiffFieldId ||
      !workdayDiffFieldId ||
      !workdayDiffHolidayFieldId ||
      !workdayInverseFieldId
    ) {
      return;
    }

    await ctx.createRecord(table.id, {
      [nameFieldId]: 'MonToFri',
      [startDateFieldId]: '2026-02-23',
      [endDateFieldId]: '2026-02-27',
    });
    await ctx.createRecord(table.id, {
      [nameFieldId]: 'MonToNextMon',
      [startDateFieldId]: '2026-02-23',
      [endDateFieldId]: '2026-03-02',
    });
    await ctx.createRecord(table.id, {
      [nameFieldId]: 'FriToMon',
      [startDateFieldId]: '2026-02-27',
      [endDateFieldId]: '2026-03-02',
    });
    await ctx.createRecord(table.id, {
      [nameFieldId]: 'SatToSun',
      [startDateFieldId]: '2026-02-28',
      [endDateFieldId]: '2026-03-01',
    });
    await ctx.createRecord(table.id, {
      [nameFieldId]: 'ReverseMonRange',
      [startDateFieldId]: '2026-03-02',
      [endDateFieldId]: '2026-02-23',
    });

    await ctx.drainOutbox();

    const records = await ctx.listRecords(table.id);
    const byName = (name: string) => records.find((record) => record.fields[nameFieldId] === name);

    const monToFri = byName('MonToFri');
    const monToNextMon = byName('MonToNextMon');
    const friToMon = byName('FriToMon');
    const satToSun = byName('SatToSun');
    const reverseMonRange = byName('ReverseMonRange');

    expect(monToFri).toBeDefined();
    expect(monToNextMon).toBeDefined();
    expect(friToMon).toBeDefined();
    expect(satToSun).toBeDefined();
    expect(reverseMonRange).toBeDefined();
    if (!monToFri || !monToNextMon || !friToMon || !satToSun || !reverseMonRange) return;

    expect(toNumber(monToFri.fields[calendarDiffFieldId])).toBe(4);
    expect(toNumber(monToFri.fields[workdayDiffFieldId])).toBe(4);
    expect(toNumber(monToFri.fields[workdayDiffHolidayFieldId])).toBe(3);

    expect(toNumber(monToNextMon.fields[calendarDiffFieldId])).toBe(7);
    expect(toNumber(monToNextMon.fields[workdayDiffFieldId])).toBe(5);
    expect(toNumber(monToNextMon.fields[workdayDiffHolidayFieldId])).toBe(4);

    expect(toNumber(friToMon.fields[calendarDiffFieldId])).toBe(3);
    expect(toNumber(friToMon.fields[workdayDiffFieldId])).toBe(1);
    expect(toNumber(friToMon.fields[workdayDiffHolidayFieldId])).toBe(1);

    expect(toNumber(satToSun.fields[calendarDiffFieldId])).toBe(1);
    expect(toNumber(satToSun.fields[workdayDiffFieldId])).toBe(0);
    expect(toNumber(satToSun.fields[workdayDiffHolidayFieldId])).toBe(0);

    expect(toNumber(reverseMonRange.fields[calendarDiffFieldId])).toBe(-7);
    expect(toNumber(reverseMonRange.fields[workdayDiffFieldId])).toBe(-5);
    expect(toNumber(reverseMonRange.fields[workdayDiffHolidayFieldId])).toBe(-4);

    expect(toNumber(monToNextMon.fields[workdayInverseFieldId])).toBe(5);
    expect(toNumber(monToNextMon.fields[workdayDiffFieldId])).toBeLessThan(
      toNumber(monToNextMon.fields[calendarDiffFieldId])
    );
  });
});
