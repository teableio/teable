/* eslint-disable @typescript-eslint/naming-convention */
import { sql } from 'kysely';
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

let fieldIdCounter = 0;
const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const deleteTableSafe = async (ctx: SharedTestContext, tableId: string | undefined) => {
  if (!tableId) return;
  try {
    await ctx.deleteTable(tableId);
  } catch {
    return undefined;
  }
};

const listRecordVersions = async (ctx: SharedTestContext, tableId: string) => {
  const result = await sql<{ __id: string; __version: number }>`
    SELECT "__id", "__version"
    FROM ${sql.table(`${ctx.baseId}.${tableId}`)}
  `.execute(ctx.testContainer.db);

  return new Map(result.rows.map((row) => [row.__id, row.__version]));
};

const expectEmptyLookup = (value: unknown) => {
  const isEmpty =
    value === null ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0) ||
    value === '[]';
  expect(isEmpty).toBe(true);
};

describe('nested lookup chain regression', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('keeps nested lookup values correct across create, link update, source update, and delete', async () => {
    let leafTableId: string | undefined;
    let bridgeTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      const leafNameFieldId = createFieldId();
      const leafAmountFieldId = createFieldId();
      const bridgeNameFieldId = createFieldId();
      const bridgeLinkFieldId = createFieldId();
      const bridgeLookupFieldId = createFieldId();
      const hostNameFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const hostLookupFieldId = createFieldId();

      const leafTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'NestedLookupLeaf',
        fields: [
          { type: 'singleLineText', id: leafNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: leafAmountFieldId, name: 'Amount' },
        ],
        views: [{ type: 'grid' }],
      });
      leafTableId = leafTable.id;

      const bridgeTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'NestedLookupBridge',
        fields: [
          { type: 'singleLineText', id: bridgeNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bridgeLinkFieldId,
            name: 'Leafs',
            options: {
              relationship: 'manyMany',
              foreignTableId: leafTable.id,
              lookupFieldId: leafNameFieldId,
              isOneWay: true,
            },
          },
          {
            type: 'lookup',
            id: bridgeLookupFieldId,
            name: 'LeafAmounts',
            options: {
              linkFieldId: bridgeLinkFieldId,
              foreignTableId: leafTable.id,
              lookupFieldId: leafAmountFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      bridgeTableId = bridgeTable.id;

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'NestedLookupHost',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Bridge',
            options: {
              relationship: 'manyOne',
              foreignTableId: bridgeTable.id,
              lookupFieldId: bridgeNameFieldId,
              isOneWay: true,
            },
          },
          {
            type: 'lookup',
            id: hostLookupFieldId,
            name: 'BridgeAmounts',
            options: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: bridgeTable.id,
              lookupFieldId: bridgeLookupFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      hostTableId = hostTable.id;

      const leafA = await ctx.createRecord(leafTable.id, {
        [leafNameFieldId]: 'Leaf-A',
        [leafAmountFieldId]: 10,
      });
      const leafB = await ctx.createRecord(leafTable.id, {
        [leafNameFieldId]: 'Leaf-B',
        [leafAmountFieldId]: 20,
      });
      const leafC = await ctx.createRecord(leafTable.id, {
        [leafNameFieldId]: 'Leaf-C',
        [leafAmountFieldId]: 30,
      });

      const bridge1 = await ctx.createRecord(bridgeTable.id, {
        [bridgeNameFieldId]: 'Bridge-1',
        [bridgeLinkFieldId]: [{ id: leafA.id }, { id: leafB.id }],
      });
      const bridge2 = await ctx.createRecord(bridgeTable.id, {
        [bridgeNameFieldId]: 'Bridge-2',
        [bridgeLinkFieldId]: [{ id: leafC.id }],
      });

      const host1 = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host-1',
        [hostLinkFieldId]: { id: bridge1.id },
      });
      const host2 = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host-2',
        [hostLinkFieldId]: { id: bridge2.id },
      });
      const host3 = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host-3',
      });

      await ctx.drainOutbox();

      const initialBridgeRecords = new Map(
        (await ctx.listRecordsWithoutDrain(bridgeTable.id)).map((record) => [record.id, record])
      );
      const initialHostRecords = new Map(
        (await ctx.listRecordsWithoutDrain(hostTable.id)).map((record) => [record.id, record])
      );

      expect(initialBridgeRecords.get(bridge1.id)?.fields[bridgeLookupFieldId]).toEqual([10, 20]);
      expect(initialBridgeRecords.get(bridge2.id)?.fields[bridgeLookupFieldId]).toEqual([30]);
      expect(initialHostRecords.get(host1.id)?.fields[hostLookupFieldId]).toEqual([10, 20]);
      expect(initialHostRecords.get(host2.id)?.fields[hostLookupFieldId]).toEqual([30]);
      expectEmptyLookup(initialHostRecords.get(host3.id)?.fields[hostLookupFieldId]);

      const host4 = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host-4',
        [hostLinkFieldId]: { id: bridge1.id },
      });
      await ctx.drainOutbox();

      let hostRecords = new Map(
        (await ctx.listRecordsWithoutDrain(hostTable.id)).map((record) => [record.id, record])
      );
      expect(hostRecords.get(host4.id)?.fields[hostLookupFieldId]).toEqual([10, 20]);

      await ctx.updateRecord(hostTable.id, host2.id, {
        [hostLinkFieldId]: { id: bridge1.id },
      });
      await ctx.drainOutbox();

      hostRecords = new Map(
        (await ctx.listRecordsWithoutDrain(hostTable.id)).map((record) => [record.id, record])
      );
      expect(hostRecords.get(host1.id)?.fields[hostLookupFieldId]).toEqual([10, 20]);
      expect(hostRecords.get(host2.id)?.fields[hostLookupFieldId]).toEqual([10, 20]);
      expect(hostRecords.get(host4.id)?.fields[hostLookupFieldId]).toEqual([10, 20]);
      expectEmptyLookup(hostRecords.get(host3.id)?.fields[hostLookupFieldId]);

      const beforeSourceUpdateVersions = await listRecordVersions(ctx, hostTable.id);
      ctx.clearLogs();

      await ctx.updateRecord(leafTable.id, leafA.id, {
        [leafAmountFieldId]: 15,
      });
      await ctx.drainOutbox();

      let bridgeRecords = new Map(
        (await ctx.listRecordsWithoutDrain(bridgeTable.id)).map((record) => [record.id, record])
      );
      hostRecords = new Map(
        (await ctx.listRecordsWithoutDrain(hostTable.id)).map((record) => [record.id, record])
      );

      expect(bridgeRecords.get(bridge1.id)?.fields[bridgeLookupFieldId]).toEqual([15, 20]);
      expect(bridgeRecords.get(bridge2.id)?.fields[bridgeLookupFieldId]).toEqual([30]);
      expect(hostRecords.get(host1.id)?.fields[hostLookupFieldId]).toEqual([15, 20]);
      expect(hostRecords.get(host2.id)?.fields[hostLookupFieldId]).toEqual([15, 20]);
      expect(hostRecords.get(host4.id)?.fields[hostLookupFieldId]).toEqual([15, 20]);
      expectEmptyLookup(hostRecords.get(host3.id)?.fields[hostLookupFieldId]);

      const afterSourceUpdateVersions = await listRecordVersions(ctx, hostTable.id);
      expect(afterSourceUpdateVersions.get(host1.id)).toBe(
        (beforeSourceUpdateVersions.get(host1.id) ?? 0) + 1
      );
      expect(afterSourceUpdateVersions.get(host2.id)).toBe(
        (beforeSourceUpdateVersions.get(host2.id) ?? 0) + 1
      );
      expect(afterSourceUpdateVersions.get(host4.id)).toBe(
        (beforeSourceUpdateVersions.get(host4.id) ?? 0) + 1
      );
      expect(afterSourceUpdateVersions.get(host3.id)).toBe(
        beforeSourceUpdateVersions.get(host3.id)
      );

      await ctx.deleteRecord(leafTable.id, leafB.id);
      await ctx.drainOutbox();

      bridgeRecords = new Map(
        (await ctx.listRecordsWithoutDrain(bridgeTable.id)).map((record) => [record.id, record])
      );
      hostRecords = new Map(
        (await ctx.listRecordsWithoutDrain(hostTable.id)).map((record) => [record.id, record])
      );

      expect(bridgeRecords.get(bridge1.id)?.fields[bridgeLookupFieldId]).toEqual([15]);
      expect(bridgeRecords.get(bridge2.id)?.fields[bridgeLookupFieldId]).toEqual([30]);
      expect(hostRecords.get(host1.id)?.fields[hostLookupFieldId]).toEqual([15]);
      expect(hostRecords.get(host2.id)?.fields[hostLookupFieldId]).toEqual([15]);
      expect(hostRecords.get(host4.id)?.fields[hostLookupFieldId]).toEqual([15]);
      expectEmptyLookup(hostRecords.get(host3.id)?.fields[hostLookupFieldId]);
    } finally {
      await deleteTableSafe(ctx, hostTableId);
      await deleteTableSafe(ctx, bridgeTableId);
      await deleteTableSafe(ctx, leafTableId);
    }
  });
});
