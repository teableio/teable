/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T7122: sanitized, structure-equivalent to production V2SchemaOperationFailure
 * BACKEND-AI-1JZ (Sentry issue 7709239944).
 *
 * Retained structural facts only:
 * - same-table number columns plus number formulas, one of which uses BLANK()
 * - a nested IF formula whose conditions compare those number formulas and
 *   whose result branches are string literals
 * - computed backfill during field create / formula expression update
 *   (table.update schema operation)
 *
 * Pre-fix, backfill died with:
 * invalid input syntax for type double precision: ""
 * Customer names, ids, and values are not copied.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 nested IF numeric-blank computed backfill (T7122)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = `ifblank${fieldIdCounter.toString(36)}`.padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  it(
    'backfills a nested string IF over number formulas that use BLANK()',
    { timeout: 180_000 },
    async () => {
      const nameFieldId = createFieldId();
      const qtyFieldId = createFieldId();
      const unitCostFieldId = createFieldId();
      const baselineUnitCostFieldId = createFieldId();
      const baselineTotalFieldId = createFieldId();
      const varianceRateFieldId = createFieldId();
      const priceAlertFieldId = createFieldId();

      let tableId: string | undefined;
      try {
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: `T7122 Price Alert ${Date.now()}`,
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'number',
              id: qtyFieldId,
              name: 'Qty',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
            {
              type: 'number',
              id: unitCostFieldId,
              name: 'Unit Cost',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
            {
              type: 'number',
              id: baselineUnitCostFieldId,
              name: 'Baseline Unit Cost',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
          ],
          views: [{ type: 'grid' }],
        });
        tableId = table.id;

        await ctx.createRecord(table.id, {
          [nameFieldId]: 'no-baseline',
          [qtyFieldId]: 10,
          [unitCostFieldId]: 8,
          [baselineUnitCostFieldId]: 0,
        });
        await ctx.createRecord(table.id, {
          [nameFieldId]: 'up',
          [qtyFieldId]: 10,
          [unitCostFieldId]: 12,
          [baselineUnitCostFieldId]: 10,
        });
        await ctx.createRecord(table.id, {
          [nameFieldId]: 'ok',
          [qtyFieldId]: 10,
          [unitCostFieldId]: 9,
          [baselineUnitCostFieldId]: 10,
        });
        await ctx.createRecord(table.id, {
          [nameFieldId]: 'blank-qty',
          [unitCostFieldId]: 9,
          [baselineUnitCostFieldId]: 10,
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            id: baselineTotalFieldId,
            name: 'Baseline Total',
            options: { expression: `{${qtyFieldId}} * {${baselineUnitCostFieldId}}` },
          },
        });
        await ctx.drainOutbox();

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            id: varianceRateFieldId,
            name: 'Variance Rate',
            options: {
              expression: `IF({${baselineTotalFieldId}}>0,({${qtyFieldId}}*{${unitCostFieldId}}-{${baselineTotalFieldId}})/{${baselineTotalFieldId}},BLANK())`,
            },
          },
        });
        await ctx.drainOutbox();

        // Production trigger: creating the nested IF formula backfills existing
        // rows inside table.update. Pre-fix this dead-lettered with
        // invalid input syntax for type double precision: "".
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            id: priceAlertFieldId,
            name: 'Price Alert',
            options: {
              expression: `IF({${baselineTotalFieldId}}<=0,"no baseline",IF({${varianceRateFieldId}}>0.05,"up",IF({${varianceRateFieldId}}>0,"high","ok")))`,
            },
          },
        });
        await ctx.drainOutbox();

        const tableAfter = await ctx.getTableById(table.id);
        const alertMeta = tableAfter.fields.find((field) => field.id === priceAlertFieldId);
        expect(alertMeta?.hasError).toBeFalsy();
        expect(alertMeta?.cellValueType).toBe('string');

        const records = await ctx.listRecords(table.id);
        const byName = (name: string) =>
          records.find((record) => record.fields[nameFieldId] === name);
        expect(byName('no-baseline')?.fields[priceAlertFieldId]).toBe('no baseline');
        expect(byName('up')?.fields[priceAlertFieldId]).toBe('up');
        expect(byName('ok')?.fields[priceAlertFieldId]).toBe('ok');
        expect(byName('blank-qty')?.fields[priceAlertFieldId]).toBe('no baseline');
      } finally {
        if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
      }
    }
  );

  it(
    'backfills a number IF whose else branch is an empty string',
    { timeout: 180_000 },
    async () => {
      const nameFieldId = createFieldId();
      const amountFieldId = createFieldId();
      const alertFieldId = createFieldId();

      let tableId: string | undefined;
      try {
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: `T7122 Empty Else ${Date.now()}`,
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'number',
              id: amountFieldId,
              name: 'Amount',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
          ],
          views: [{ type: 'grid' }],
        });
        tableId = table.id;

        await ctx.createRecord(table.id, { [nameFieldId]: 'zero', [amountFieldId]: 0 });
        await ctx.createRecord(table.id, { [nameFieldId]: 'positive', [amountFieldId]: 12.5 });
        await ctx.createRecord(table.id, { [nameFieldId]: 'blank' });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            id: alertFieldId,
            name: 'Amount Or Blank',
            options: {
              expression: `IF({${amountFieldId}}<=0,"",{${amountFieldId}})`,
            },
          },
        });
        await ctx.drainOutbox();

        const tableAfter = await ctx.getTableById(table.id);
        const alertMeta = tableAfter.fields.find((field) => field.id === alertFieldId);
        expect(alertMeta?.hasError).toBeFalsy();

        const records = await ctx.listRecords(table.id);
        const byName = (name: string) =>
          records.find((record) => record.fields[nameFieldId] === name);
        expect(byName('zero')?.fields[alertFieldId] ?? null).toBeNull();
        expect(byName('blank')?.fields[alertFieldId] ?? null).toBeNull();
        expect(Number(byName('positive')?.fields[alertFieldId])).toBe(12.5);
      } finally {
        if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
      }
    }
  );

  it(
    'changes a number formula expression to the nested string IF',
    { timeout: 180_000 },
    async () => {
      const nameFieldId = createFieldId();
      const qtyFieldId = createFieldId();
      const baselineUnitCostFieldId = createFieldId();
      const formulaFieldId = createFieldId();

      let tableId: string | undefined;
      try {
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: `T7122 Number To String IF ${Date.now()}`,
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'number',
              id: qtyFieldId,
              name: 'Qty',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
            {
              type: 'number',
              id: baselineUnitCostFieldId,
              name: 'Baseline Unit Cost',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
          ],
          views: [{ type: 'grid' }],
        });
        tableId = table.id;

        await ctx.createRecord(table.id, {
          [nameFieldId]: 'no-baseline',
          [qtyFieldId]: 10,
          [baselineUnitCostFieldId]: 0,
        });
        await ctx.createRecord(table.id, {
          [nameFieldId]: 'ok',
          [qtyFieldId]: 10,
          [baselineUnitCostFieldId]: 10,
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            id: formulaFieldId,
            name: 'Price Alert',
            options: { expression: `{${qtyFieldId}} * {${baselineUnitCostFieldId}}` },
          },
        });
        await ctx.drainOutbox();

        await ctx.updateField({
          tableId: table.id,
          fieldId: formulaFieldId,
          field: {
            type: 'formula',
            options: {
              expression: `IF({${qtyFieldId}}*{${baselineUnitCostFieldId}}<=0,"no baseline","ok")`,
            },
          },
        });
        await ctx.drainOutbox();

        const tableAfter = await ctx.getTableById(table.id);
        const formulaMeta = tableAfter.fields.find((field) => field.id === formulaFieldId);
        expect(formulaMeta?.hasError).toBeFalsy();
        expect(formulaMeta?.cellValueType).toBe('string');

        const records = await ctx.listRecords(table.id);
        const byName = (name: string) =>
          records.find((record) => record.fields[nameFieldId] === name);
        expect(byName('no-baseline')?.fields[formulaFieldId]).toBe('no baseline');
        expect(byName('ok')?.fields[formulaFieldId]).toBe('ok');
      } finally {
        if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
      }
    }
  );
});
