/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

let fieldIdCounter = 0;
const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

describe('update-field: FORCE_V2_ALL regressions', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test(
    'converts threshold to text without throwing and marks conditionalRollup errored for numeric comparison',
    { timeout: 120_000 },
    async () => {
      let hostTableId: string | undefined;
      let foreignTableId: string | undefined;

      try {
        const foreignScoreFieldId = createFieldId();
        const foreignTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('v1p-cond-rollup-foreign'),
          fields: [
            { type: 'singleLineText', name: 'Player', isPrimary: true },
            { type: 'number', name: 'Score', id: foreignScoreFieldId },
          ],
          records: [
            { fields: { Player: 'Alpha', [foreignScoreFieldId]: 10 } },
            { fields: { Player: 'Beta', [foreignScoreFieldId]: 7 } },
          ],
        });
        foreignTableId = foreignTable.id;

        const thresholdFieldId = createFieldId();
        const hostTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('v1p-cond-rollup-host'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Threshold', id: thresholdFieldId },
          ],
          records: [{ fields: { Name: 'Host-1', [thresholdFieldId]: 8 } }],
        });
        hostTableId = hostTable.id;

        const rollupFieldId = createFieldId();
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'conditionalRollup',
            id: rollupFieldId,
            name: 'Scores Above Threshold',
            options: {
              expression: 'sum({values})',
              timeZone: 'utc',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignScoreFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignScoreFieldId,
                      operator: 'isGreater',
                      value: thresholdFieldId,
                      isSymbol: true,
                    },
                  ],
                },
              },
            },
          },
        });

        await ctx.drainOutbox();

        await ctx.updateField({
          tableId: hostTable.id,
          fieldId: thresholdFieldId,
          field: {
            type: 'singleLineText',
            options: {},
          },
        });

        await ctx.drainOutbox();

        const refreshed = await ctx.getTableById(hostTable.id);
        const rollupField = refreshed.fields.find((field) => field.id === rollupFieldId);
        expect(rollupField?.type).toBe('conditionalRollup');
        expect(rollupField?.hasError).toBe(true);
      } finally {
        if (hostTableId) {
          await ctx.deleteTable(hostTableId).catch(() => undefined);
        }
        if (foreignTableId) {
          await ctx.deleteTable(foreignTableId).catch(() => undefined);
        }
      }
    }
  );

  test(
    'converts benchmark number text->number with dependent formula without backfill type mismatch',
    { timeout: 120_000 },
    async () => {
      let tableId: string | undefined;

      try {
        const numberFieldId = createFieldId();
        const numberFieldBId = createFieldId();
        const formulaFieldId = createFieldId();

        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('v1p-benchmark-formula'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'number',
              id: numberFieldId,
              name: 'Benchmark Number',
              options: { formatting: { type: 'decimal', precision: 0 } },
            },
            {
              type: 'number',
              id: numberFieldBId,
              name: 'Benchmark Number B',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
          ],
        });
        tableId = table.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'formula',
            id: formulaFieldId,
            name: 'Benchmark Formula',
            options: { expression: `({${numberFieldId}}) + ({${numberFieldBId}})` },
          },
        });

        const records = Array.from({ length: 500 }, (_, index) => ({
          fields: {
            Name: `R-${index + 1}`,
            [numberFieldId]: (index % 11) + 1,
            [numberFieldBId]: (index % 7) + 0.5,
          },
        }));
        await ctx.createRecords(tableId, records);

        await ctx.drainOutbox();

        await ctx.updateField({
          tableId,
          fieldId: numberFieldId,
          field: {
            type: 'singleLineText',
            options: {},
          },
        });

        await ctx.updateField({
          tableId,
          fieldId: numberFieldId,
          field: {
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 0 } },
          },
        });

        await ctx.drainOutbox();

        const rows = await ctx.listRecords(tableId, { limit: 20, offset: 0 });
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.fields[formulaFieldId]).not.toBeNull();
          expect(row.fields[formulaFieldId]).not.toBeUndefined();
        }
      } finally {
        if (tableId) {
          await ctx.deleteTable(tableId).catch(() => undefined);
        }
      }
    }
  );
});
