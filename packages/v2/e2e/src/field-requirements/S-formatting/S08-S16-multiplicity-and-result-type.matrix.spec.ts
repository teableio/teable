/**
 * S08 / S16 — display configuration follows the result shape.
 *
 * S08 (实现依据): a multi-value numeric result offers a line/bar series and never
 * the single-value ring; a single-value result offers bar/ring (with
 * `showValue` and `maxValue`) and never a line. The document asks the same for
 * multi-value numbers in general, so the pair is asserted in both directions.
 *
 * S16 (实现依据): computed fields validate their formatting against the *result*
 * type, so a text result cannot carry number formatting and a number result
 * cannot carry date formatting. The document asks what happens to incompatible
 * configuration when the result type changes; v2 answer: it is rejected at
 * write time, so a stale configuration cannot exist.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { DateFormattingPreset, NumberFormattingType, TimeFormatting } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

/** S08 — a single-value numeric result. */
const SINGLE_RESULT_EXPRESSION = 'sum({values})';
/** S08 — a multi-value numeric result. */
const MULTI_RESULT_EXPRESSION = 'array_unique({values})';

/** The single-value widget configuration. */
const RING = { type: 'ring', color: 'blueBright', showValue: true, maxValue: 10 } as const;
/** The multi-value widget configuration. */
const LINE = { type: 'line', color: 'blueBright' } as const;

const NUMBER_FORMATTING = { type: NumberFormattingType.Decimal, precision: 3 } as const;
const DATE_FORMATTING = {
  date: DateFormattingPreset.ISO,
  time: TimeFormatting.None,
  timeZone: 'utc',
} as const;

describe('S08/S16: display configuration follows the result shape', () => {
  let ctx: SharedTestContext;
  let foreignTableId: string;
  let foreignScoreId: string;
  let linkFieldId: string;
  let tableId: string;
  let seq = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'S08 Foreign',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Score' },
      ],
      views: [{ type: 'grid' }],
    });
    foreignTableId = foreign.id;
    foreignScoreId = fieldByName(foreign, 'Score').id;

    const host = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'S08 Host',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          name: 'Link',
          options: {
            relationship: 'manyMany',
            foreignTableId,
            lookupFieldId: fieldByName(foreign, 'Title').id,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = host.id;
    linkFieldId = fieldByName(host, 'Link').id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
  });

  const createRollup = async (
    expression: string,
    options: Record<string, unknown>
  ): Promise<{ fieldId: string; name: string } | { error: string }> => {
    seq += 1;
    const name = `S08-${seq}`;
    try {
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'rollup',
          name,
          options: { expression, ...options } as never,
          config: { linkFieldId, foreignTableId, lookupFieldId: foreignScoreId },
        },
      });
      return { fieldId: fieldByName(created, name).id, name };
    } catch (error) {
      return { error: (error as Error).message };
    }
  };

  describe('S08 the widget must match the result multiplicity', () => {
    it('accepts the ring on a single-value result', async () => {
      const created = await createRollup(SINGLE_RESULT_EXPRESSION, { showAs: RING });
      expect('fieldId' in created).toBe(true);
      if (!('fieldId' in created)) return;

      const reloaded = await ctx.getTableById(tableId);
      expect(fieldOptions(reloaded.fields.find((f) => f.id === created.fieldId)).showAs).toEqual(
        RING
      );
    });

    it('accepts the line on a multi-value result', async () => {
      const created = await createRollup(MULTI_RESULT_EXPRESSION, { showAs: LINE });
      expect('fieldId' in created).toBe(true);
      if (!('fieldId' in created)) return;

      const reloaded = await ctx.getTableById(tableId);
      expect(fieldOptions(reloaded.fields.find((f) => f.id === created.fieldId)).showAs).toEqual(
        LINE
      );
    });

    it('rejects the line on a single-value result', async () => {
      const created = await createRollup(SINGLE_RESULT_EXPRESSION, { showAs: LINE });
      expect(created).toMatchObject({ error: expect.stringMatching(/showAs/i) });
    });

    it('rejects the ring on a multi-value result', async () => {
      const created = await createRollup(MULTI_RESULT_EXPRESSION, { showAs: RING });
      expect(created).toMatchObject({ error: expect.stringMatching(/showAs/i) });
    });

    it('rejects an unknown display type in either shape', async () => {
      const created = await createRollup(SINGLE_RESULT_EXPRESSION, {
        showAs: { type: 'sparkline', color: 'blueBright' },
      });
      // The closed display-type enum is enforced by request validation, so the
      // rejection is a generic bad request rather than a field-level message.
      expect('error' in created).toBe(true);
    });

    it('a lookup drops a display configuration it cannot express', async () => {
      // A lookup's options only carry the reference and formatting; the display
      // widget belongs to the field that owns the value shape.
      seq += 1;
      const name = `S08-lookup-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'lookup',
          name,
          options: { linkFieldId, foreignTableId, lookupFieldId: foreignScoreId },
        },
      });
      const fieldId = fieldByName(created, name).id;
      await ctx.updateField({
        tableId,
        fieldId,
        field: { options: { showAs: RING } as never },
      });
      const reloaded = await ctx.getTableById(tableId);
      expect(fieldOptions(reloaded.fields.find((f) => f.id === fieldId)).showAs).toBeFalsy();
    });
  });

  describe('S16 formatting is validated against the result type', () => {
    it('accepts number formatting on a number result', async () => {
      seq += 1;
      const name = `S16-num-${seq}`;
      const table = await ctx.getTableById(tableId);
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'rollup',
          name,
          options: { expression: SINGLE_RESULT_EXPRESSION, formatting: NUMBER_FORMATTING } as never,
          config: { linkFieldId, foreignTableId, lookupFieldId: foreignScoreId },
        },
      });
      const fieldId = fieldByName(created, name).id;
      expect(fieldOptions(created.fields.find((f) => f.id === fieldId)).formatting).toMatchObject({
        type: NumberFormattingType.Decimal,
        precision: 3,
      });
      expect(table).toBeTruthy();
    });

    it('rejects date formatting on a number result', async () => {
      const created = await createRollup(SINGLE_RESULT_EXPRESSION, {
        formatting: DATE_FORMATTING,
      });
      expect(created).toMatchObject({ error: expect.stringMatching(/formatting/i) });
    });
  });

  describe('S16 the same rule applies to formula fields', () => {
    let formulaTableId: string;
    let numberFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'S16 Formula',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'number', name: 'N', options: { defaultValue: 3 } },
        ],
        views: [{ type: 'grid' }],
      });
      formulaTableId = table.id;
      numberFieldId = fieldByName(table, 'N').id;
    });

    const createFormula = async (expression: string, formatting: unknown) => {
      seq += 1;
      const name = `S16-f-${seq}`;
      try {
        const created = await ctx.createField({
          baseId: ctx.baseId,
          tableId: formulaTableId,
          field: { type: 'formula', name, options: { expression, formatting } as never },
        });
        return { fieldId: fieldByName(created, name).id };
      } catch (error) {
        return { error: (error as Error).message };
      }
    };

    it('accepts number formatting when the formula returns a number', async () => {
      const created = await createFormula(`{${numberFieldId}} + 1`, NUMBER_FORMATTING);
      expect('fieldId' in created).toBe(true);
    });

    it('rejects number formatting when the formula returns text', async () => {
      const created = await createFormula('"a text result"', NUMBER_FORMATTING);
      expect(created).toMatchObject({ error: expect.stringMatching(/formatting/i) });
    });

    it('rejects date formatting when the formula returns a number', async () => {
      const created = await createFormula(`{${numberFieldId}} + 1`, DATE_FORMATTING);
      expect(created).toMatchObject({ error: expect.stringMatching(/formatting/i) });
    });

    it('accepts date formatting when the formula returns a date', async () => {
      const created = await createFormula('NOW()', DATE_FORMATTING);
      expect('fieldId' in created).toBe(true);
    });
  });
});
