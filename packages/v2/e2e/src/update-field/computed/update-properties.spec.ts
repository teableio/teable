/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

let globalFieldIdCounter = 0;
const createGlobalFieldId = () => {
  const suffix = globalFieldIdCounter.toString(36).padStart(16, '0');
  globalFieldIdCounter += 1;
  return `fld${suffix}`;
};

const makeCondition = (fieldId: string, value: string) => ({
  filter: {
    conjunction: 'and' as const,
    filterSet: [{ fieldId, operator: 'is', value }],
  },
});

describe('update-field: computed/system property updates', () => {
  let ctx: SharedTestContext;
  let hostTableId: string;
  let hostPrimaryFieldId: string;
  let foreignTableId: string;
  let foreignPrimaryFieldId: string;
  let foreignNumberFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Computed Update Foreign',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');
    foreignPrimaryFieldId = foreignPrimary.id;
    const amountField = foreignTable.fields.find((f) => f.name === 'Amount');
    if (!amountField) throw new Error('No foreign amount field');
    foreignNumberFieldId = amountField.id;

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Computed Update Host',
      fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
    });
    hostTableId = hostTable.id;
    const primaryField = hostTable.fields.find((f) => f.isPrimary);
    if (!primaryField) throw new Error('No host primary field');
    hostPrimaryFieldId = primaryField.id;
  });

  afterAll(async () => {
    try {
      if (hostTableId) await ctx.deleteTable(hostTableId);
    } catch {
      // ignore cleanup failure
    }
    try {
      if (foreignTableId) await ctx.deleteTable(foreignTableId);
    } catch {
      // ignore cleanup failure
    }
  });

  test('should update createdTime name and formatting', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: { type: 'createdTime', id: fieldId, name: 'Created At' },
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        name: 'Created Time Updated',
        options: {
          formatting: { date: 'M/D/YYYY', time: 'HH:mm', timeZone: 'utc' },
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | { type?: string; name?: string; options?: { formatting?: { date?: string } } }
      | undefined;
    expect(updatedField?.type).toBe('createdTime');
    expect(updatedField?.name).toBe('Created Time Updated');
    expect(updatedField?.options?.formatting?.date).toBe('M/D/YYYY');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update lastModifiedTime name, formatting and trackedFieldIds', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: { type: 'lastModifiedTime', id: fieldId, name: 'Updated At' },
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        name: 'Last Modified Updated',
        options: {
          formatting: { date: 'YYYY/MM/DD', time: 'None', timeZone: 'utc' },
          trackedFieldIds: [hostPrimaryFieldId],
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | {
          type?: string;
          name?: string;
          options?: { trackedFieldIds?: string[]; formatting?: { date?: string } };
        }
      | undefined;
    expect(updatedField?.type).toBe('lastModifiedTime');
    expect(updatedField?.name).toBe('Last Modified Updated');
    expect(updatedField?.options?.formatting?.date).toBe('YYYY/MM/DD');
    expect(updatedField?.options?.trackedFieldIds).toEqual([hostPrimaryFieldId]);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update createdBy field name', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: { type: 'createdBy', id: fieldId, name: 'Creator' },
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { name: 'Created By Updated' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('createdBy');
    expect(updatedField?.name).toBe('Created By Updated');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update lastModifiedBy name and trackedFieldIds', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: { type: 'lastModifiedBy', id: fieldId, name: 'Editor' },
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        name: 'Last Editor Updated',
        options: {
          trackedFieldIds: [hostPrimaryFieldId],
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | { type?: string; name?: string; options?: { trackedFieldIds?: string[] } }
      | undefined;
    expect(updatedField?.type).toBe('lastModifiedBy');
    expect(updatedField?.name).toBe('Last Editor Updated');
    expect(updatedField?.options?.trackedFieldIds).toEqual([hostPrimaryFieldId]);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update autoNumber field name', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: { type: 'autoNumber', id: fieldId, name: 'No.' },
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { name: 'Auto Number Updated' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('autoNumber');
    expect(updatedField?.name).toBe('Auto Number Updated');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update conditionalLookup name and options', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        id: fieldId,
        name: 'Cond Lookup',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Seed'),
        },
      },
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        name: 'Cond Lookup Updated',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Updated'),
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | {
          name?: string;
          isLookup?: boolean;
          conditionalLookupOptions?: {
            condition?: { filter?: { filterSet?: Array<{ value?: string }> } };
          };
        }
      | undefined;
    expect(updatedField?.name).toBe('Cond Lookup Updated');
    expect(updatedField?.isLookup).toBe(true);
    expect(updatedField?.conditionalLookupOptions?.condition?.filter?.filterSet?.[0]?.value).toBe(
      'Updated'
    );

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update conditionalRollup name and config', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: fieldId,
        name: 'Cond Rollup',
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Seed'),
        },
      },
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        name: 'Cond Rollup Updated',
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Updated'),
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | {
          type?: string;
          name?: string;
          config?: { condition?: { filter?: { filterSet?: Array<{ value?: string }> } } };
        }
      | undefined;
    expect(updatedField?.type).toBe('conditionalRollup');
    expect(updatedField?.name).toBe('Cond Rollup Updated');
    expect(updatedField?.config?.condition?.filter?.filterSet?.[0]?.value).toBe('Updated');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });
});
