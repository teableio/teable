/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

let fieldIdCounter = 0;
let tableNameCounter = 0;

const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const uniqueTableName = (prefix: string) => {
  tableNameCounter += 1;
  return `${prefix}-${tableNameCounter}-${Date.now()}`;
};

const deleteTableSafe = async (ctx: SharedTestContext, tableId: string | undefined) => {
  if (!tableId) return;
  try {
    await ctx.deleteTable(tableId);
  } catch {
    return undefined;
  }
};

const valueAt = (value: unknown) => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

describe('lookup autoNumber regression', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('uses the linked record auto number instead of the host row auto number', async () => {
    let sourceTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      const sourceNameFieldId = createFieldId();
      const sourceAutoNumberFieldId = createFieldId();
      const sourceNumberFieldId = createFieldId();
      const hostNameFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const hostLookupAutoNumberFieldId = createFieldId();
      const hostLookupNumberFieldId = createFieldId();
      const hostRollupAutoNumberFieldId = createFieldId();

      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('LookupAutoNumberSource'),
        fields: [
          { type: 'singleLineText', id: sourceNameFieldId, name: 'Name', isPrimary: true },
          { type: 'autoNumber', id: sourceAutoNumberFieldId, name: 'AutoNum' },
          { type: 'number', id: sourceNumberFieldId, name: 'Number' },
        ],
        views: [{ type: 'grid' }],
      });
      sourceTableId = sourceTable.id;

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('LookupAutoNumberHost'),
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Link to Source',
            options: {
              relationship: 'manyMany',
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: hostLookupAutoNumberFieldId,
            name: 'Lookup AutoNum',
            options: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceAutoNumberFieldId,
            },
          },
          {
            type: 'lookup',
            id: hostLookupNumberFieldId,
            name: 'Lookup Number',
            options: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceNumberFieldId,
            },
          },
          {
            type: 'rollup',
            id: hostRollupAutoNumberFieldId,
            name: 'Rollup AutoNum',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceAutoNumberFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      hostTableId = hostTable.id;

      const hostTableMeta = await ctx.getTableById(hostTable.id);
      const lookupAutoNumberField = hostTableMeta.fields.find(
        (field) => field.id === hostLookupAutoNumberFieldId
      );
      expect(lookupAutoNumberField?.type).toBe('autoNumber');
      expect(lookupAutoNumberField?.isLookup).toBe(true);
      expect(lookupAutoNumberField?.options).toEqual({ expression: 'AUTO_NUMBER()' });

      const source1 = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'Record A1',
        [sourceNumberFieldId]: 1,
      });
      const source2 = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'Record A2',
        [sourceNumberFieldId]: 2,
      });
      const source3 = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'Record A3',
        [sourceNumberFieldId]: 3,
      });

      const host1 = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Row B1',
        [hostLinkFieldId]: [{ id: source3.id }],
      });
      const host2 = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Row B2',
        [hostLinkFieldId]: [{ id: source1.id }],
      });
      const host3 = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Row B3',
        [hostLinkFieldId]: [{ id: source2.id }],
      });

      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecordsWithoutDrain(hostTable.id);
      const byId = new Map(hostRecords.map((record) => [record.id, record]));

      expect(byId.get(host1.id)?.fields[hostLookupNumberFieldId]).toEqual([3]);
      expect(byId.get(host2.id)?.fields[hostLookupNumberFieldId]).toEqual([1]);
      expect(byId.get(host3.id)?.fields[hostLookupNumberFieldId]).toEqual([2]);

      expect(byId.get(host1.id)?.fields[hostRollupAutoNumberFieldId]).toBe(3);
      expect(byId.get(host2.id)?.fields[hostRollupAutoNumberFieldId]).toBe(1);
      expect(byId.get(host3.id)?.fields[hostRollupAutoNumberFieldId]).toBe(2);

      expect(valueAt(byId.get(host1.id)?.fields[hostLookupAutoNumberFieldId])).toBe(3);
      expect(valueAt(byId.get(host2.id)?.fields[hostLookupAutoNumberFieldId])).toBe(1);
      expect(valueAt(byId.get(host3.id)?.fields[hostLookupAutoNumberFieldId])).toBe(2);
    } finally {
      await deleteTableSafe(ctx, hostTableId);
      await deleteTableSafe(ctx, sourceTableId);
    }
  });
});
