/**
 * S11 / S12 — date and time display configuration.
 *
 * S11 (实现依据): the date preset list and the three time modes come straight
 * from `DateFormattingPreset` / `TimeFormatting`. Each combination must
 * round-trip so the document's "自定义格式在 UI/API 的合法范围须确认" can be
 * closed.
 * S12 (实现依据): the field timezone drives display only. Hiding the time must
 * not truncate the stored instant, which is asserted by writing distinct
 * instants inside the same calendar day.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { DateFormattingPreset, TimeFormatting } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  findRow,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

/** S11 — the presets named in the requirement document. */
const DATE_PRESETS = [
  DateFormattingPreset.US,
  DateFormattingPreset.European,
  DateFormattingPreset.Asian,
  DateFormattingPreset.ISO,
  DateFormattingPreset.YM,
  DateFormattingPreset.MD,
  DateFormattingPreset.Y,
  DateFormattingPreset.M,
  DateFormattingPreset.D,
] as const;

/** S11 — no time, 12 hour and 24 hour. */
const TIME_MODES = [TimeFormatting.None, TimeFormatting.Hour12, TimeFormatting.Hour24] as const;

const TIME_ZONES = ['utc', 'Asia/Singapore', 'America/Los_Angeles', 'Europe/London'] as const;

describe('S11/S12: date and time display configuration', () => {
  let ctx: SharedTestContext;
  let tableId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'S11 Date Formatting',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  const createDateField = async (name: string, formatting: Record<string, unknown>) => {
    const table = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'date', name, options: { formatting } as never },
    });
    return fieldByName(table, name);
  };

  describe('S11 date presets', () => {
    it.each(DATE_PRESETS)('round-trips the %s preset', async (preset) => {
      const name = `Date-preset-${preset}`;
      const reloaded = await createDateField(name, {
        date: preset,
        time: TimeFormatting.None,
        timeZone: 'utc',
      });
      const formatting = fieldOptions(reloaded).formatting as { date: string; time: string };
      expect(formatting.date).toBe(preset);
      expect(formatting.time).toBe(TimeFormatting.None);
    });
  });

  describe('S11 time modes', () => {
    it.each(TIME_MODES)('round-trips the %s mode', async (mode) => {
      const name = `Date-time-${mode}`;
      const reloaded = await createDateField(name, {
        date: DateFormattingPreset.ISO,
        time: mode,
        timeZone: 'utc',
      });
      const formatting = fieldOptions(reloaded).formatting as { date: string; time: string };
      expect(formatting.date).toBe(DateFormattingPreset.ISO);
      expect(formatting.time).toBe(mode);
    });

    it('rejects an unknown time mode', async () => {
      await expect(
        createDateField('Date-time-invalid', {
          date: DateFormattingPreset.ISO,
          time: 'HH:mm:ss',
          timeZone: 'utc',
        })
      ).rejects.toThrow();
    });
  });

  describe('S12 timezone configuration', () => {
    it.each(TIME_ZONES)('round-trips the %s timezone', async (timeZone) => {
      const name = `Date-tz-${timeZone.replace('/', '-')}`;
      const reloaded = await createDateField(name, {
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.Hour24,
        timeZone,
      });
      const formatting = fieldOptions(reloaded).formatting as { timeZone: string };
      expect(formatting.timeZone).toBe(timeZone);
    });

    it('S12 hiding the time keeps distinct instants inside one calendar day', async () => {
      const name = 'Date-hide-time';
      const created = await createDateField(name, {
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.None,
        timeZone: 'utc',
      });

      const morning = await ctx.createRecord(tableId, {
        [created.id]: '2024-03-05T01:15:00.000Z',
      });
      const evening = await ctx.createRecord(tableId, {
        [created.id]: '2024-03-05T23:45:00.000Z',
      });

      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      const morningValue = findRow(rows, morning.id)?.fields[created.id];
      const eveningValue = findRow(rows, evening.id)?.fields[created.id];

      // Both stay on 2024-03-05 but remain different instants: the display mode
      // must not collapse them.
      expect(morningValue).not.toBe(eveningValue);
      expect(new Date(morningValue as string).toISOString()).toBe('2024-03-05T01:15:00.000Z');
      expect(new Date(eveningValue as string).toISOString()).toBe('2024-03-05T23:45:00.000Z');
    });

    test('S12 the field timezone does not shift the stored instant', async () => {
      const instant = '2024-03-05T23:45:00.000Z';
      const perZone = await Promise.all(
        TIME_ZONES.map(async (timeZone) => {
          const name = `Date-stored-${timeZone.replace('/', '-')}`;
          const field = await createDateField(name, {
            date: DateFormattingPreset.ISO,
            time: TimeFormatting.Hour24,
            timeZone,
          });
          const record = await ctx.createRecord(tableId, { [field.id]: instant });
          const rows = await ctx.listRecords(tableId, { limit: 1000 });
          return findRow(rows, record.id)?.fields[field.id];
        })
      );

      for (const stored of perZone) {
        expect(new Date(stored as string).toISOString()).toBe(instant);
      }
    });
  });

  describe('S11/S12 date default and formatting interplay', () => {
    test('rejects a static date default while accepting `now`', async () => {
      const table = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'date',
          name: 'Date-default-now',
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.Hour24,
              timeZone: 'utc',
            },
            defaultValue: 'now',
          },
        },
      });
      expect(fieldOptions(fieldByName(table, 'Date-default-now')).defaultValue).toBe('now');

      await expect(
        ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'date',
            name: 'Date-default-static',
            options: { defaultValue: '2024-03-05T00:00:00.000Z' } as never,
          },
        })
      ).rejects.toThrow();
    });
  });
});
