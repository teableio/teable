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

describe('update-field: conditionalRollup property updates', () => {
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
      name: 'CondRollup Props Foreign',
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
      name: 'CondRollup Props Host',
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

  test('should rename a conditional rollup field', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: fieldId,
        name: 'CR Original',
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
      field: { name: 'CR Renamed' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('conditionalRollup');
    expect(updatedField?.name).toBe('CR Renamed');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update expression', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: fieldId,
        name: 'CR Expr Update',
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
        options: {
          expression: 'count({values})',
          timeZone: 'utc',
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | { type?: string; options?: { expression?: string } }
      | undefined;
    expect(updatedField?.type).toBe('conditionalRollup');
    expect(updatedField?.options?.expression).toBe('count({values})');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update filter condition', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: fieldId,
        name: 'CR Filter Update',
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'OldValue'),
        },
      },
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'NewValue'),
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | {
          type?: string;
          config?: { condition?: { filter?: { filterSet?: Array<{ value?: string }> } } };
        }
      | undefined;
    expect(updatedField?.type).toBe('conditionalRollup');
    expect(updatedField?.config?.condition?.filter?.filterSet?.[0]?.value).toBe('NewValue');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update dynamic date filter condition', async () => {
    const fieldId = createFieldId();
    let tempForeignTableId = '';
    let tempHostTableId = '';

    try {
      const tempForeignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `CR Dynamic Date Foreign ${fieldId}`,
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', name: 'Hours' },
          {
            type: 'date',
            name: 'Due Date',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            },
          },
        ],
      });
      tempForeignTableId = tempForeignTable.id;
      const tempForeignPrimaryFieldId = tempForeignTable.fields.find((f) => f.isPrimary)?.id;
      const tempForeignNumberFieldId = tempForeignTable.fields.find((f) => f.name === 'Hours')?.id;
      const tempForeignDateFieldId = tempForeignTable.fields.find((f) => f.name === 'Due Date')?.id;
      if (!tempForeignPrimaryFieldId || !tempForeignNumberFieldId || !tempForeignDateFieldId) {
        throw new Error('Failed to resolve temporary foreign fields');
      }

      const tempHostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `CR Dynamic Date Host ${fieldId}`,
        fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
      });
      tempHostTableId = tempHostTable.id;
      const tempHostPrimaryFieldId = tempHostTable.fields.find((f) => f.isPrimary)?.id;
      if (!tempHostPrimaryFieldId) {
        throw new Error('Failed to resolve temporary host primary field');
      }

      const now = new Date();
      const today = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0, 0)
      );
      const yesterday = new Date(today);
      yesterday.setUTCDate(today.getUTCDate() - 1);

      await ctx.createRecord(tempForeignTableId, {
        [tempForeignPrimaryFieldId]: 'Today',
        [tempForeignNumberFieldId]: 5,
        [tempForeignDateFieldId]: today.toISOString(),
      });
      await ctx.createRecord(tempForeignTableId, {
        [tempForeignPrimaryFieldId]: 'Yesterday',
        [tempForeignNumberFieldId]: 7,
        [tempForeignDateFieldId]: yesterday.toISOString(),
      });
      const hostRecord = await ctx.createRecord(tempHostTableId, {
        [tempHostPrimaryFieldId]: 'Host',
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: tempHostTableId,
        field: {
          type: 'conditionalRollup',
          id: fieldId,
          name: 'CR Dynamic Date',
          options: {
            expression: 'sum({values})',
            timeZone: 'utc',
          },
          config: {
            foreignTableId: tempForeignTableId,
            lookupFieldId: tempForeignNumberFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: tempForeignDateFieldId, operator: 'isNotEmpty' }],
              },
            },
          },
        },
      });

      const beforeRecords = await ctx.listRecords(tempHostTableId);
      expect(beforeRecords.find((record) => record.id === hostRecord.id)?.fields[fieldId]).toBe(12);

      const updatedTable = await ctx.updateField({
        tableId: tempHostTableId,
        fieldId,
        field: {
          config: {
            foreignTableId: tempForeignTableId,
            lookupFieldId: tempForeignNumberFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: tempForeignDateFieldId,
                    operator: 'is',
                    value: {
                      mode: 'today',
                      timeZone: 'utc',
                    },
                  },
                ],
              },
            },
          },
        },
      });

      const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
        | {
            type?: string;
            config?: {
              condition?: {
                filter?: {
                  filterSet?: Array<{
                    fieldId?: string;
                    operator?: string;
                    value?: { mode?: string; timeZone?: string };
                  }>;
                };
              };
            };
          }
        | undefined;
      const filterItem = updatedField?.config?.condition?.filter?.filterSet?.[0];
      expect(updatedField?.type).toBe('conditionalRollup');
      expect(filterItem).toMatchObject({
        fieldId: tempForeignDateFieldId,
        operator: 'is',
        value: { mode: 'today', timeZone: 'utc' },
      });

      const afterRecords = await ctx.listRecords(tempHostTableId);
      expect(afterRecords.find((record) => record.id === hostRecord.id)?.fields[fieldId]).toBe(5);
    } finally {
      if (tempHostTableId) {
        await ctx.deleteTable(tempHostTableId).catch(() => undefined);
      }
      if (tempForeignTableId) {
        await ctx.deleteTable(tempForeignTableId).catch(() => undefined);
      }
    }
  });

  test('should update sort and limit', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: fieldId,
        name: 'CR Sort Limit',
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
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: {
            ...makeCondition(foreignPrimaryFieldId, 'Seed'),
            sort: { fieldId: foreignNumberFieldId, order: 'desc' as const },
            limit: 10,
          },
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | {
          type?: string;
          config?: {
            condition?: {
              sort?: { fieldId?: string; order?: string };
              limit?: number;
            };
          };
        }
      | undefined;
    expect(updatedField?.type).toBe('conditionalRollup');
    expect(updatedField?.config?.condition?.sort?.order).toBe('desc');
    expect(updatedField?.config?.condition?.limit).toBe(10);

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
        type: 'conditionalRollup',
        id: fieldId,
        name: `CR Clear Sort ${fieldId}`,
        options: {
          expression: 'array_compact({values})',
          timeZone: 'utc',
        },
        config: {
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
        config: {
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
          config?: {
            condition?: {
              sort?: { fieldId?: string; order?: string };
              limit?: number;
            };
          };
        }
      | undefined;
    expect(updatedField?.config?.condition?.sort).toBeUndefined();
    expect(updatedField?.config?.condition?.limit).toBeUndefined();

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
        type: 'conditionalRollup',
        id: fieldId,
        name: 'CR Change Lookup',
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
        config: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Seed'),
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | { type?: string; config?: { lookupFieldId?: string } }
      | undefined;
    expect(updatedField?.type).toBe('conditionalRollup');
    expect(updatedField?.config?.lookupFieldId).toBe(foreignPrimaryFieldId);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update formatting', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: fieldId,
        name: 'CR Formatting Update',
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
          formatting: { type: 'decimal', precision: 0 },
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
        options: {
          formatting: { type: 'decimal', precision: 3 },
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | {
          type?: string;
          options?: {
            formatting?: { type?: string; precision?: number };
          };
        }
      | undefined;
    expect(updatedField?.type).toBe('conditionalRollup');
    expect(updatedField?.options?.formatting?.type).toBe('decimal');
    expect(updatedField?.options?.formatting?.precision).toBe(3);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should clear sort and limit when converting from array aggregation to single-value aggregation', async () => {
    const fieldId = createFieldId();
    // Create a conditional rollup with array aggregation (array_join) with sort and limit
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: fieldId,
        name: 'CR Array to Single',
        options: {
          expression: 'array_join({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: {
            ...makeCondition(foreignPrimaryFieldId, 'Seed'),
            sort: { fieldId: foreignNumberFieldId, order: 'desc' as const },
            limit: 5,
          },
        },
      },
    });

    // Verify initial state has sort and limit
    const initialTable = await ctx.getTableById(hostTableId);
    const initialField = initialTable.fields.find((f) => f.id === fieldId) as
      | {
          type?: string;
          config?: {
            condition?: {
              sort?: { fieldId?: string; order?: string };
              limit?: number;
            };
          };
        }
      | undefined;
    expect(initialField?.config?.condition?.sort).toBeDefined();
    expect(initialField?.config?.condition?.limit).toBe(5);

    // Update expression to single-value aggregation (sum)
    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        options: {
          expression: 'sum({values})',
        },
      },
    });

    // Verify sort and limit are cleared
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | {
          type?: string;
          options?: { expression?: string };
          config?: {
            condition?: {
              sort?: { fieldId?: string; order?: string };
              limit?: number;
            };
          };
        }
      | undefined;
    expect(updatedField?.type).toBe('conditionalRollup');
    expect(updatedField?.options?.expression).toBe('sum({values})');
    expect(updatedField?.config?.condition?.sort).toBeUndefined();
    expect(updatedField?.config?.condition?.limit).toBeUndefined();

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });
});
