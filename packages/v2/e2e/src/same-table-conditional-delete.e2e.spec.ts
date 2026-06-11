/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 same-table conditional fields on delete (e2e)', () => {
  let ctx: SharedTestContext;
  let idCounter = 0;

  const createFieldId = () => {
    const suffix = idCounter.toString(36).padStart(16, '0');
    idCounter += 1;
    return `fld${suffix}`;
  };

  const uniqueName = (prefix: string) => `${prefix}_${idCounter.toString(36)}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('recomputes same-table conditionalRollup after deleting a matching row', async () => {
    const nameFieldId = createFieldId();
    const codeFieldId = createFieldId();
    const amountFieldId = createFieldId();
    const countFieldId = createFieldId();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('SameTableConditionalRollupDelete'),
      fields: [
        { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
        { type: 'singleLineText', id: codeFieldId, name: 'Code' },
        { type: 'number', id: amountFieldId, name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'conditionalRollup',
        id: countFieldId,
        name: 'CountCode2',
        options: {
          expression: 'countall({values})',
        },
        config: {
          foreignTableId: table.id,
          lookupFieldId: amountFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: codeFieldId,
                  operator: 'is',
                  value: '2',
                },
              ],
            },
          },
        },
      },
    });

    await ctx.createRecord(table.id, {
      [nameFieldId]: 'Row 1',
      [codeFieldId]: '3',
      [amountFieldId]: 10,
    });
    const deletedRecord = await ctx.createRecord(table.id, {
      [nameFieldId]: 'Row 2',
      [codeFieldId]: '2',
      [amountFieldId]: 20,
    });
    await ctx.createRecord(table.id, {
      [nameFieldId]: 'Row 3',
      [codeFieldId]: '2',
      [amountFieldId]: 30,
    });

    await ctx.drainOutbox();

    const beforeDelete = await ctx.listRecordsWithoutDrain(table.id);
    expect(beforeDelete).toHaveLength(3);
    for (const record of beforeDelete) {
      expect(Number(record.fields[countFieldId])).toBe(2);
    }

    await ctx.deleteRecord(table.id, deletedRecord.id);
    await ctx.drainOutbox();

    const afterDelete = await ctx.listRecordsWithoutDrain(table.id);
    expect(afterDelete).toHaveLength(2);
    for (const record of afterDelete) {
      expect(Number(record.fields[countFieldId])).toBe(1);
    }
  });

  it('recomputes same-table conditionalLookup after deleting a matching row', async () => {
    const nameFieldId = createFieldId();
    const codeFieldId = createFieldId();
    const amountFieldId = createFieldId();
    const lookupFieldId = createFieldId();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('SameTableConditionalLookupDelete'),
      fields: [
        { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
        { type: 'singleLineText', id: codeFieldId, name: 'Code' },
        { type: 'number', id: amountFieldId, name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'conditionalLookup',
        id: lookupFieldId,
        name: 'AmountsCode2',
        options: {
          foreignTableId: table.id,
          lookupFieldId: amountFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: codeFieldId,
                  operator: 'is',
                  value: '2',
                },
              ],
            },
          },
        },
      },
    });

    await ctx.createRecord(table.id, {
      [nameFieldId]: 'Row 1',
      [codeFieldId]: '3',
      [amountFieldId]: 10,
    });
    const deletedRecord = await ctx.createRecord(table.id, {
      [nameFieldId]: 'Row 2',
      [codeFieldId]: '2',
      [amountFieldId]: 20,
    });
    await ctx.createRecord(table.id, {
      [nameFieldId]: 'Row 3',
      [codeFieldId]: '2',
      [amountFieldId]: 30,
    });

    await ctx.drainOutbox();

    const beforeDelete = await ctx.listRecordsWithoutDrain(table.id);
    expect(beforeDelete).toHaveLength(3);
    for (const record of beforeDelete) {
      expect(record.fields[lookupFieldId]).toEqual([20, 30]);
    }

    await ctx.deleteRecord(table.id, deletedRecord.id);
    await ctx.drainOutbox();

    const afterDelete = await ctx.listRecordsWithoutDrain(table.id);
    expect(afterDelete).toHaveLength(2);
    for (const record of afterDelete) {
      expect(record.fields[lookupFieldId]).toEqual([30]);
    }
  });
});
