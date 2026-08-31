/* eslint-disable @typescript-eslint/naming-convention */
/**
 * V2 Formula metadata-aware coercion E2E Tests
 *
 * Ported from v1 formula-metadata-coercion.e2e-spec.ts ("runtime formulas" group).
 *
 * The v1 spec has two halves:
 * 1. SQL-generation assertions (generated columns / select-query conversion via
 *    dbProvider.convertFormulaToSelectQuery + information_schema inspection).
 *    These are v1 engine internals and are NOT portable to v2.
 * 2. Runtime record-value assertions ("runtime formulas"), which are portable and
 *    covered here:
 *    - concatenates typed fields without redundant casts
 *    - evaluates AND conditions using typed operands
 *    - keeps BLANK as null in standalone formulas and IF branches across types
 */
import { describe, beforeAll, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http formula metadata-aware coercion (e2e)', () => {
  let ctx: SharedTestContext;
  const uniqueName = (prefix: string) =>
    `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  type CreateTableFields = Parameters<SharedTestContext['createTable']>[0]['fields'];

  const makeTable = async (name: string, fields: CreateTableFields) =>
    ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName(name),
      fields,
      views: [{ type: 'grid' }],
    });

  const makeFormula = async (tableId: string, name: string, expression: string) => {
    const updatedTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        name,
        options: { expression },
      },
    });
    const fieldId = updatedTable.fields.find((f) => f.name === name)?.id ?? '';
    expect(fieldId).not.toBe('');
    return fieldId;
  };

  const readFields = async (tableId: string, recordId: string) => {
    const records = await ctx.listRecords(tableId);
    const record = records.find((r) => r.id === recordId);
    expect(record).toBeDefined();
    if (!record) throw new Error(`record ${recordId} not found`);
    return record.fields;
  };

  describe('runtime formulas', () => {
    it('concatenates typed fields without redundant casts', async () => {
      const table = await makeTable('formula_metadata_concat', [
        { type: 'singleLineText', name: 'Label', isPrimary: true },
        { type: 'number', name: 'Qty' },
      ]);
      const labelId = table.fields.find((f) => f.name === 'Label')?.id ?? '';
      const qtyId = table.fields.find((f) => f.name === 'Qty')?.id ?? '';

      const concatId = await makeFormula(
        table.id,
        'Label Qty',
        `{${labelId}} & ' x ' & {${qtyId}} & '!'`
      );

      const record = await ctx.createRecord(table.id, {
        [labelId]: 'Widget',
        [qtyId]: 3,
      });
      await ctx.drainOutbox();
      expect((await readFields(table.id, record.id))[concatId]).toBe('Widget x 3!');

      await ctx.updateRecord(table.id, record.id, { [labelId]: 'Gadget', [qtyId]: 1 });
      await ctx.drainOutbox();
      expect((await readFields(table.id, record.id))[concatId]).toBe('Gadget x 1!');
    });

    it('evaluates AND conditions using typed operands', async () => {
      const table = await makeTable('formula_metadata_logic', [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'checkbox', name: 'Enabled' },
        { type: 'number', name: 'Attempts' },
      ]);
      const enabledId = table.fields.find((f) => f.name === 'Enabled')?.id ?? '';
      const attemptsId = table.fields.find((f) => f.name === 'Attempts')?.id ?? '';

      const logicId = await makeFormula(
        table.id,
        'Should Trigger',
        `IF(AND({${enabledId}}, {${attemptsId}}), 1, 0)`
      );

      const record = await ctx.createRecord(table.id, {
        [enabledId]: true,
        [attemptsId]: 0,
      });
      await ctx.drainOutbox();
      expect((await readFields(table.id, record.id))[logicId]).toBe(0);

      await ctx.updateRecord(table.id, record.id, { [attemptsId]: 2 });
      await ctx.drainOutbox();
      expect((await readFields(table.id, record.id))[logicId]).toBe(1);

      // v1 stores unchecked (false) as null (T6520); AND(null, 2) is still falsy
      await ctx.updateRecord(table.id, record.id, { [enabledId]: false });
      await ctx.drainOutbox();
      expect((await readFields(table.id, record.id))[logicId]).toBe(0);
    });

    it('keeps BLANK as null in standalone formulas and IF branches across types', async () => {
      const dueDateValue = '2025-02-02T00:00:00.000Z';
      const table = await makeTable('formula_blank_runtime', [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
        {
          type: 'date',
          name: 'Due',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
          },
        },
      ]);
      const amountId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';
      const dueId = table.fields.find((f) => f.name === 'Due')?.id ?? '';

      const blankId = await makeFormula(table.id, 'Standalone Blank', 'BLANK()');
      const dateWhenTrueId = await makeFormula(
        table.id,
        'Date When True',
        `IF(TRUE, {${dueId}}, BLANK())`
      );
      const dateWhenFalseId = await makeFormula(
        table.id,
        'Blank When False',
        `IF(FALSE, {${dueId}}, BLANK())`
      );
      const numberWhenTrueId = await makeFormula(
        table.id,
        'Number When True',
        `IF(TRUE, {${amountId}}, BLANK())`
      );
      const numberWhenFalseId = await makeFormula(
        table.id,
        'Blank When False Number',
        `IF(FALSE, {${amountId}}, BLANK())`
      );

      const record = await ctx.createRecord(table.id, {
        [amountId]: 12,
        [dueId]: dueDateValue,
      });
      await ctx.drainOutbox();

      const fields = await readFields(table.id, record.id);
      expect(fields[blankId] ?? null).toBeNull();
      expect(fields[dateWhenTrueId]).toBe(dueDateValue);
      expect(fields[dateWhenFalseId] ?? null).toBeNull();
      expect(fields[numberWhenTrueId]).toBe(12);
      expect(fields[numberWhenFalseId] ?? null).toBeNull();
    });
  });
});
