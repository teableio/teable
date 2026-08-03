/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

let fieldIdCounter = 0;
const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const makeCondition = (fieldId: string, value: string) => ({
  filter: {
    conjunction: 'and' as const,
    filterSet: [{ fieldId, operator: 'is', value }],
  },
});

describe('update-field: conditionalLookup property updates', () => {
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
      name: 'CondLookup Props Foreign',
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
      name: 'CondLookup Props Host',
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

  test('should rename a conditional lookup field', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        id: fieldId,
        name: 'CL Original',
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
      field: { name: 'CL Renamed' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | { name?: string; isLookup?: boolean }
      | undefined;
    expect(updatedField?.name).toBe('CL Renamed');
    expect(updatedField?.isLookup).toBe(true);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update filter condition', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        id: fieldId,
        name: 'CL Filter Update',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'OldValue'),
        },
      },
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'NewValue'),
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | {
          isLookup?: boolean;
          conditionalLookupOptions?: {
            condition?: { filter?: { filterSet?: Array<{ value?: string }> } };
          };
        }
      | undefined;
    expect(updatedField?.isLookup).toBe(true);
    expect(updatedField?.conditionalLookupOptions?.condition?.filter?.filterSet?.[0]?.value).toBe(
      'NewValue'
    );

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update sort condition', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        id: fieldId,
        name: 'CL Sort Update',
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
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: {
            ...makeCondition(foreignPrimaryFieldId, 'Seed'),
            sort: { fieldId: foreignPrimaryFieldId, order: 'desc' as const },
          },
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | {
          isLookup?: boolean;
          conditionalLookupOptions?: {
            condition?: { sort?: { fieldId?: string; order?: string } };
          };
        }
      | undefined;
    expect(updatedField?.isLookup).toBe(true);
    expect(updatedField?.conditionalLookupOptions?.condition?.sort?.order).toBe('desc');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update limit', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        id: fieldId,
        name: 'CL Limit Update',
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
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: {
            ...makeCondition(foreignPrimaryFieldId, 'Seed'),
            limit: 5,
          },
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | {
          isLookup?: boolean;
          conditionalLookupOptions?: {
            condition?: { limit?: number };
          };
        }
      | undefined;
    expect(updatedField?.isLookup).toBe(true);
    expect(updatedField?.conditionalLookupOptions?.condition?.limit).toBe(5);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should clear sort and limit when condition update omits them', async () => {
    const fieldId = createFieldId();
    const foreignStatus = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTableId,
      field: { type: 'singleLineText', name: `Status ${fieldId}` },
    });
    const statusField = foreignStatus.fields.find((f) => f.name === `Status ${fieldId}`);
    if (!statusField) throw new Error('No foreign status field');

    const hostFilter = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: { type: 'singleLineText', name: `Filter ${fieldId}` },
    });
    const hostFilterField = hostFilter.fields.find((f) => f.name === `Filter ${fieldId}`);
    if (!hostFilterField) throw new Error('No host filter field');

    const foreignRow1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: `row-1-${fieldId}`,
      [statusField.id]: 'Active',
      [foreignNumberFieldId]: 10,
    });
    const foreignRow2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: `row-2-${fieldId}`,
      [statusField.id]: 'Active',
      [foreignNumberFieldId]: 20,
    });
    const hostRow = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: `host-${fieldId}`,
      [hostFilterField.id]: 'Active',
    });

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        id: fieldId,
        name: `CL Clear Sort ${fieldId}`,
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: statusField.id,
                  operator: 'is',
                  value: { type: 'field', fieldId: hostFilterField.id },
                },
              ],
            },
            sort: { fieldId: foreignNumberFieldId, order: 'desc' as const },
            limit: 1,
          },
        },
      },
    });

    const beforeRecords = await ctx.listRecords(hostTableId);
    const beforeValue = beforeRecords.find((record) => record.id === hostRow.id)?.fields[
      fieldId
    ] as string[] | undefined;
    expect(beforeValue).toEqual([foreignRow2.fields[foreignPrimaryFieldId]]);

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: statusField.id,
                  operator: 'is',
                  value: { type: 'field', fieldId: hostFilterField.id },
                },
              ],
            },
          },
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | {
          conditionalLookupOptions?: {
            condition?: {
              sort?: { fieldId?: string; order?: string };
              limit?: number;
            };
          };
        }
      | undefined;
    expect(updatedField?.conditionalLookupOptions?.condition?.sort).toBeUndefined();
    expect(updatedField?.conditionalLookupOptions?.condition?.limit).toBeUndefined();

    const afterRecords = await ctx.listRecords(hostTableId);
    const afterValue = afterRecords.find((record) => record.id === hostRow.id)?.fields[fieldId] as
      | string[]
      | undefined;
    expect([...(afterValue ?? [])].sort()).toEqual([
      foreignRow1.fields[foreignPrimaryFieldId],
      foreignRow2.fields[foreignPrimaryFieldId],
    ]);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteField({ tableId: hostTableId, fieldId: hostFilterField.id });
    await ctx.deleteField({ tableId: foreignTableId, fieldId: statusField.id });
  });

  test('should change lookupFieldId', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        id: fieldId,
        name: 'CL Change Lookup',
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
        options: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Seed'),
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | {
          isLookup?: boolean;
          conditionalLookupOptions?: {
            lookupFieldId?: string;
          };
        }
      | undefined;
    expect(updatedField?.isLookup).toBe(true);
    expect(updatedField?.conditionalLookupOptions?.lookupFieldId).toBe(foreignNumberFieldId);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should rename and update filter combined', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        id: fieldId,
        name: 'CL Combined',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'OldSeed'),
        },
      },
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        name: 'CL Combined Updated',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'NewSeed'),
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
    expect(updatedField?.name).toBe('CL Combined Updated');
    expect(updatedField?.isLookup).toBe(true);
    expect(updatedField?.conditionalLookupOptions?.condition?.filter?.filterSet?.[0]?.value).toBe(
      'NewSeed'
    );

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });
});
