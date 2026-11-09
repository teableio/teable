/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

// Sanitized scalar date/formula structure from Y3763. Fixed timestamps cover
// whole day units in the formula timezone, independently of display formatting.
describe('v2 http DATETIME_DIFF complete days (Y3763)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  it('truncates positive, negative and sub-day intervals on create and update', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Complete elapsed days',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'date',
          name: 'Event Date',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'America/Chicago' },
          },
        },
        { type: 'date', name: 'Start' },
        { type: 'singleLineText', name: 'Unit' },
      ],
      views: [{ type: 'grid' }],
    });
    const fieldId = (name: string) => table.fields.find((field) => field.name === name)!.id;
    const eventId = fieldId('Event Date');
    const startId = fieldId('Start');
    const unitId = fieldId('Unit');
    const formulas = [
      ['Day', `DATETIME_DIFF({${eventId}}, {${startId}}, 'day')`],
      ['Days', `DATETIME_DIFF({${eventId}}, {${startId}}, 'days')`],
      ['Dynamic', `DATETIME_DIFF({${eventId}}, {${startId}}, {${unitId}})`],
      ['FloatDay', `DATETIME_DIFF({${eventId}}, {${startId}}, 'day', TRUE)`],
      ['FloatDynamic', `DATETIME_DIFF({${eventId}}, {${startId}}, {${unitId}}, TRUE)`],
      ['IntegerDay', `DATETIME_DIFF({${eventId}}, {${startId}}, 'days', FALSE)`],
      ['Default', `DATETIME_DIFF({${eventId}}, {${startId}})`],
      ['Milliseconds', `DATETIME_DIFF({${eventId}}, {${startId}}, 'ms')`],
      ['Hours', `DATETIME_DIFF({${eventId}}, {${startId}}, 'hours')`],
      ['Today', 'TODAY()'],
      ['FromToday', `DATETIME_DIFF({${eventId}}, TODAY(), 'day')`],
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
    const start = '2026-01-10T16:00:00.000Z';
    const cases = [
      { name: 'Positive', date: '2026-01-12T12:00:00.000Z', days: 1, hours: 44 },
      { name: 'Negative', date: '2026-01-08T20:00:00.000Z', days: -1, hours: -44 },
      { name: 'SubdayPositive', date: '2026-01-11T12:00:00.000Z', days: 0, hours: 20 },
      { name: 'SubdayNegative', date: '2026-01-09T20:00:00.000Z', days: 0, hours: -20 },
      { name: 'Empty', date: null, days: null, hours: null },
    ];
    await ctx.createRecords(
      table.id,
      cases.map(({ name, date }, index) => ({
        fields: {
          [fieldId('Name')]: name,
          [eventId]: date,
          [startId]: start,
          [unitId]: index % 2 ? 'days' : 'day',
        },
      }))
    );
    await ctx.drainOutbox();
    const rows = await ctx.listRecords(table.id);
    for (const testCase of cases) {
      const row = rows.find((record) => record.fields[fieldId('Name')] === testCase.name)!;
      for (const name of ['Day', 'Days', 'Dynamic', 'IntegerDay']) {
        expect(row.fields[formulaIds[name]] ?? null, `${testCase.name} ${name}`).toBe(
          testCase.days
        );
      }
      expect(row.fields[formulaIds.Default] ?? null).toBe(
        testCase.hours === null ? null : testCase.hours * 3600
      );
      expect(row.fields[formulaIds.Milliseconds] ?? null).toBe(
        testCase.hours === null ? null : testCase.hours * 3600_000
      );
      expect(row.fields[formulaIds.Hours] ?? null).toBe(testCase.hours);
      for (const name of ['FloatDay', 'FloatDynamic']) {
        if (testCase.hours === null) {
          expect(row.fields[formulaIds[name]] ?? null).toBeNull();
        } else {
          expect(row.fields[formulaIds[name]]).toBeCloseTo(testCase.hours / 24, 10);
        }
      }
      if (testCase.date) {
        // Use the materialized TODAY from the same write, not the machine's day.
        const today = Date.parse(row.fields[formulaIds.Today] as string);
        expect(row.fields[formulaIds.FromToday]).toBe(
          Math.trunc((Date.parse(testCase.date) - today) / 86400_000)
        );
      }
    }
    const positive = rows.find((row) => row.fields[fieldId('Name')] === 'Positive')!;
    await ctx.updateRecord(table.id, positive.id, {
      [eventId]: '2026-01-08T20:00:00.000Z',
      [unitId]: 'days',
    });
    await ctx.drainOutbox();
    const updated = (await ctx.listRecords(table.id)).find((row) => row.id === positive.id)!;
    for (const name of ['Day', 'Days', 'Dynamic', 'IntegerDay']) {
      expect(updated.fields[formulaIds[name]], `updated ${name}`).toBe(-1);
    }
    const today = Date.parse(updated.fields[formulaIds.Today] as string);
    expect(updated.fields[formulaIds.FromToday]).toBe(
      Math.trunc((Date.parse('2026-01-08T20:00:00.000Z') - today) / 86400_000)
    );
  });

  it.each([
    {
      zone: 'America/Chicago',
      cases: [
        ['Spring day', '2026-03-08T06:00:00Z', '2026-03-09T05:00:00Z', 1],
        ['Spring month', '2026-03-01T06:00:00Z', '2026-03-31T05:00:00Z', 30],
        ['Fall day', '2026-11-01T05:00:00Z', '2026-11-02T06:00:00Z', 1],
        ['No DST', '2026-01-10T06:00:00Z', '2026-01-20T06:00:00Z', 10],
        // Local 12:00 -> 11:00 is less than a whole day, even across a date boundary.
        ['Spring partial', '2026-03-07T18:00:00Z', '2026-03-08T16:00:00Z', 23 / 24],
        ['Fall partial', '2026-10-31T17:00:00Z', '2026-11-01T17:00:00Z', 23 / 24],
      ],
    },
    {
      zone: 'Australia/Lord_Howe',
      cases: [
        ['Half-hour spring', '2026-10-03T13:30:00Z', '2026-10-04T13:00:00Z', 1],
        ['Half-hour fall', '2026-04-04T13:00:00Z', '2026-04-05T13:30:00Z', 1],
        ['Half-hour partial', '2026-10-03T01:30:00Z', '2026-10-04T00:30:00Z', 23.5 / 24],
      ],
    },
    {
      // Source fields remain Chicago date-only: the formula zone controls diff.
      zone: 'UTC',
      cases: [['Different formula zone', '2026-03-08T06:00:00Z', '2026-03-09T05:00:00Z', 23 / 24]],
    },
  ])('uses offset-adjusted day units in $zone through HTTP', async ({ zone, cases }) => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Timezone day units',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        ...['Start', 'End'].map((name) => ({
          type: 'date' as const,
          name,
          options: {
            formatting: {
              date: 'YYYY-MM-DD' as const,
              time: 'None' as const,
              timeZone: zone === 'UTC' ? 'America/Chicago' : zone,
            },
          },
        })),
        { type: 'singleLineText', name: 'Unit' },
      ],
      views: [{ type: 'grid' }],
    });
    const fieldId = (name: string) => table.fields.find((field) => field.name === name)!.id;
    const startId = fieldId('Start');
    const endId = fieldId('End');
    const unitId = fieldId('Unit');
    const args = `{${endId}}, {${startId}}`;
    const formulas = [
      ['Day', `DATETIME_DIFF(${args}, 'day')`],
      ['Days', `DATETIME_DIFF(${args}, 'days')`],
      ['Dynamic', `DATETIME_DIFF(${args}, {${unitId}})`],
      ['False', `DATETIME_DIFF(${args}, 'day', FALSE)`],
      ['Fraction', `DATETIME_DIFF(${args}, 'days', TRUE)`],
      ['DynamicFraction', `DATETIME_DIFF(${args}, {${unitId}}, TRUE)`],
      ['Rounded', `ROUND(DATETIME_DIFF(${args}, 'day'))`],
      ['Seconds', `DATETIME_DIFF(${args})`],
      ['Hours', `DATETIME_DIFF(${args}, 'hours')`],
    ];
    const formulaIds: Record<string, string> = {};
    for (const [name, expression] of formulas) {
      const updated = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: { type: 'formula', name, options: { expression, timeZone: zone } },
      });
      formulaIds[name] = updated.fields.find((field) => field.name === name)!.id;
    }
    const intervals = cases.flatMap(([name, start, end, days]) => [
      { name: `${name} forward`, start: String(start), end: String(end), days: Number(days) },
      { name: `${name} reverse`, start: String(end), end: String(start), days: -Number(days) },
    ]);
    const records = [
      ...intervals,
      { name: 'Empty start', start: null, end: '2026-03-09T05:00:00Z', days: null },
      { name: 'Empty end', start: '2026-03-08T06:00:00Z', end: null, days: null },
    ];
    await ctx.createRecords(
      table.id,
      records.map(({ name, start, end }, index) => ({
        fields: {
          [fieldId('Name')]: name,
          [startId]: start,
          [endId]: end,
          [unitId]: index % 2 ? 'days' : 'day',
        },
      }))
    );
    await ctx.drainOutbox();
    const rows = await ctx.listRecords(table.id);
    for (const interval of records) {
      const row = rows.find((record) => record.fields[fieldId('Name')] === interval.name)!;
      for (const name of ['Day', 'Days', 'Dynamic', 'False', 'Rounded']) {
        // Normalize JS's -0: SQL numeric zero has no sign.
        const expected = interval.days === null ? null : Math.trunc(interval.days) || 0;
        expect(row.fields[formulaIds[name]] ?? null, `${interval.name} ${name}`).toBe(expected);
      }
      for (const name of ['Fraction', 'DynamicFraction']) {
        if (interval.days === null) {
          expect(row.fields[formulaIds[name]] ?? null).toBeNull();
        } else {
          expect(row.fields[formulaIds[name]], `${interval.name} ${name}`).toBeCloseTo(
            interval.days,
            10
          );
        }
      }
      const seconds =
        interval.start && interval.end
          ? (Date.parse(interval.end) - Date.parse(interval.start)) / 1000
          : null;
      expect(row.fields[formulaIds.Seconds] ?? null).toBe(seconds);
      expect(row.fields[formulaIds.Hours] ?? null).toBe(seconds === null ? null : seconds / 3600);
    }
    const first = intervals[0];
    const firstRow = rows.find((record) => record.fields[fieldId('Name')] === first.name)!;
    await ctx.updateRecord(table.id, firstRow.id, {
      [startId]: first.end,
      [endId]: first.start,
      [unitId]: 'days',
    });
    await ctx.drainOutbox();
    const updated = (await ctx.listRecords(table.id)).find((row) => row.id === firstRow.id)!;
    for (const name of ['Day', 'Days', 'Dynamic', 'False', 'Rounded']) {
      expect(updated.fields[formulaIds[name]]).toBe(Math.trunc(-first.days) || 0);
    }
    for (const name of ['Fraction', 'DynamicFraction']) {
      expect(updated.fields[formulaIds[name]]).toBeCloseTo(-first.days, 10);
    }
  });
});
