/**
 * S03 / S04 / S05 / S07 — numeric display configuration.
 *
 * S03 (实现依据): precision is bounded to 0–5 and defaults to 2 when the field
 * is created without a formatting block.
 * S04/S05 (实现依据): percent and currency are display-only layers — the stored
 * value must stay the raw number so switching format never rewrites data.
 * S07 (实现依据): `maxValue` is the 100% reference for the bar/ring widget, not
 * a data cap, so out-of-range values must survive a `showAs` update.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { NumberFormattingType } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  findRow,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

/** S03 — the legal precision domain from the document. */
const LEGAL_PRECISION = [0, 1, 2, 3, 4, 5] as const;
const ILLEGAL_PRECISION = [-1, 6, 2.5] as const;

/** S03 — the core fallback when no formatting is configured. */
const DEFAULT_PRECISION = 2;

/** S07 — the two single-value widgets. */
const SINGLE_DISPLAY_TYPES = ['bar', 'ring'] as const;

/** S04/S05 — every formatting kind, with its extra property. */
const FORMATTING_CASES = [
  { label: 'decimal', type: NumberFormattingType.Decimal, symbol: undefined },
  { label: 'percent', type: NumberFormattingType.Percent, symbol: undefined },
  { label: 'currency', type: NumberFormattingType.Currency, symbol: 'USD' },
  { label: 'currency with another symbol', type: NumberFormattingType.Currency, symbol: 'CNY' },
] as const;

describe('S03/S04/S05/S07: numeric display configuration', () => {
  let ctx: SharedTestContext;
  let tableId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'S03 Number Formatting',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  describe('S03 precision domain', () => {
    it('falls back to precision 2 when no formatting is configured', async () => {
      const table = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'number', name: `P-default-${Date.now()}` },
      });
      const created = table.fields.find((field) => field.name.startsWith('P-default-'));
      const formatting = fieldOptions(created).formatting as
        | { type: string; precision: number }
        | undefined;
      expect(formatting?.type).toBe(NumberFormattingType.Decimal);
      expect(formatting?.precision).toBe(DEFAULT_PRECISION);
    });

    it.each(LEGAL_PRECISION)('accepts precision %i', async (precision) => {
      const name = `P-legal-${precision}`;
      const table = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'number',
          name,
          options: { formatting: { type: NumberFormattingType.Decimal, precision } },
        },
      });
      const formatting = fieldOptions(fieldByName(table, name)).formatting as {
        precision: number;
      };
      expect(formatting.precision).toBe(precision);
    });

    it.each(ILLEGAL_PRECISION)('rejects precision %s', async (precision) => {
      await expect(
        ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'number',
            name: `P-illegal-${String(precision)}`,
            options: { formatting: { type: NumberFormattingType.Decimal, precision } },
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('S04/S05 formatting kind and symbol', () => {
    it.each(FORMATTING_CASES)(
      'round-trips $label without touching the stored value',
      async ({ label, type, symbol }) => {
        const name = `F-${label}-${String(symbol ?? 'none')}`;
        const table = await ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'number',
            name,
            options: {
              formatting: { type, precision: 2, ...(symbol ? { symbol } : {}) },
            } as never,
          },
        });
        const fieldId = fieldByName(table, name).id;

        // S04's worked example: 0.125 stays 0.125 on the wire and is the UI's
        // job to render as 12.50%.
        const record = await ctx.createRecord(tableId, { [fieldId]: 0.125 });
        const rows = await ctx.listRecords(tableId, { limit: 1000 });
        expect(findRow(rows, record.id)?.fields[fieldId]).toBe(0.125);

        await ctx.updateField({
          tableId,
          fieldId,
          field: { options: { formatting: { type, precision: 4, ...(symbol ? { symbol } : {}) } } },
        });

        const reloaded = await ctx.getTableById(tableId);
        const formatting = fieldOptions(reloaded.fields.find((field) => field.id === fieldId))
          .formatting as { type: string; precision: number; symbol?: string };
        expect(formatting.type).toBe(type);
        expect(formatting.precision).toBe(4);
        if (symbol) expect(formatting.symbol).toBe(symbol);

        // S02: reformatting never rewrites the number.
        const afterRows = await ctx.listRecords(tableId, { limit: 1000 });
        expect(findRow(afterRows, record.id)?.fields[fieldId]).toBe(0.125);
      }
    );

    test('S05 keeps out-of-range and negative values untouched', async () => {
      const name = 'F-currency-extremes';
      const table = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'number',
          name,
          options: {
            formatting: { type: NumberFormattingType.Currency, precision: 2, symbol: 'USD' },
          },
        },
      });
      const fieldId = fieldByName(table, name).id;
      const values = [-1234.5678, 0, 1e15, -0.0000001, -1e-15];
      const records = await Promise.all(
        values.map((value) => ctx.createRecord(tableId, { [fieldId]: value }))
      );
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      records.forEach((record, index) => {
        expect(findRow(rows, record.id)?.fields[fieldId]).toBe(values[index]);
      });
    });

    test('S06 negative zero is not distinguishable from zero on the wire', async () => {
      const name = 'F-negative-zero';
      const table = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'number',
          name,
          options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
        },
      });
      const fieldId = fieldByName(table, name).id;
      const record = await ctx.createRecord(tableId, { [fieldId]: -0 });
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      const stored = findRow(rows, record.id)?.fields[fieldId];
      expect(stored).toBe(0);
      expect(Object.is(stored, -0)).toBe(false);
    });
  });

  describe('S07 bar/ring widget configuration', () => {
    it.each(SINGLE_DISPLAY_TYPES)('round-trips the %s widget', async (displayType) => {
      const name = `ShowAs-${displayType}`;
      const table = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'number',
          name,
          options: {
            showAs: { type: displayType, color: 'blueBright', showValue: true, maxValue: 100 },
          },
        },
      });
      const fieldId = fieldByName(table, name).id;

      const reloaded = await ctx.getTableById(tableId);
      const showAs = fieldOptions(reloaded.fields.find((field) => field.id === fieldId)).showAs;
      expect(showAs).toEqual({
        type: displayType,
        color: 'blueBright',
        showValue: true,
        maxValue: 100,
      });
    });

    test('S07 maxValue is a scale reference, not a data cap', async () => {
      const name = 'ShowAs-maxValue';
      const table = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'number',
          name,
          options: {
            showAs: { type: 'bar', color: 'greenBright', showValue: true, maxValue: 100 },
          },
        },
      });
      const fieldId = fieldByName(table, name).id;

      // Values beyond maxValue, negative values and a zero scale denominator
      // must all survive.
      const beyond = await ctx.createRecord(tableId, { [fieldId]: 250 });
      const negative = await ctx.createRecord(tableId, { [fieldId]: -50 });
      const zero = await ctx.createRecord(tableId, { [fieldId]: 0 });

      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, beyond.id)?.fields[fieldId]).toBe(250);
      expect(findRow(rows, negative.id)?.fields[fieldId]).toBe(-50);
      expect(findRow(rows, zero.id)?.fields[fieldId]).toBe(0);

      // Shrinking maxValue below the stored values must not clamp them.
      await ctx.updateField({
        tableId,
        fieldId,
        field: {
          options: { showAs: { type: 'ring', color: 'redBright', showValue: false, maxValue: 10 } },
        },
      });
      const afterRows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(afterRows, beyond.id)?.fields[fieldId]).toBe(250);
    });

    test('S07 removing the widget configuration clears it', async () => {
      const name = 'ShowAs-remove';
      const table = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'number',
          name,
          options: {
            showAs: { type: 'bar', color: 'yellowBright', showValue: true, maxValue: 50 },
          },
        },
      });
      const fieldId = fieldByName(table, name).id;

      await ctx.updateField({ tableId, fieldId, field: { options: { showAs: null } } });

      const reloaded = await ctx.getTableById(tableId);
      expect(
        fieldOptions(reloaded.fields.find((field) => field.id === fieldId)).showAs
      ).toBeFalsy();
    });

    it('S07 rejects an unknown widget type', async () => {
      await expect(
        ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'number',
            name: 'ShowAs-invalid',
            options: {
              showAs: { type: 'sparkline', color: 'blueBright', showValue: true, maxValue: 10 },
            } as never,
          },
        })
      ).rejects.toThrow();
    });
  });
});
