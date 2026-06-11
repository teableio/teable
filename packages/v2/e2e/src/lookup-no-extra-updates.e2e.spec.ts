/* eslint-disable @typescript-eslint/naming-convention */
import {
  buildMultiTableNameMaps,
  formatComputedPlanSnapshot,
} from '@teable/v2-container-node-test';
import { RecordsBatchUpdated } from '@teable/v2-core';
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

describe('lookup computed update scope regression', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('updates only linked host records when foreign lookup source changes', async () => {
    let sourceTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      const sourceNameFieldId = createFieldId();
      const sourceValueFieldId = createFieldId();
      const hostNameFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const hostLookupFieldId = createFieldId();

      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LookupScopeSource',
        fields: [
          { type: 'singleLineText', id: sourceNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: sourceValueFieldId, name: 'SourceValue' },
        ],
        views: [{ type: 'grid' }],
      });
      sourceTableId = sourceTable.id;

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LookupScopeHost',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Source',
            options: {
              relationship: 'manyOne',
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: hostLookupFieldId,
            name: 'LookupValue',
            options: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceValueFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      hostTableId = hostTable.id;

      const source1 = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'B-1',
        [sourceValueFieldId]: 10,
      });
      const source2 = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'B-2',
        [sourceValueFieldId]: 20,
      });

      const host1 = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'A-1',
        [hostLinkFieldId]: { id: source1.id },
      });
      const host2 = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'A-2',
        [hostLinkFieldId]: { id: source1.id },
      });
      const host3 = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'A-3',
        [hostLinkFieldId]: { id: source2.id },
      });
      const host4 = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'A-4',
      });

      await ctx.drainOutbox();

      const beforeRecords = await ctx.listRecords(hostTable.id);
      const beforeRecordsById = new Map(beforeRecords.map((record) => [record.id, record]));

      expect(beforeRecordsById.get(host1.id)?.fields[hostLookupFieldId]).toEqual([10]);
      expect(beforeRecordsById.get(host2.id)?.fields[hostLookupFieldId]).toEqual([10]);
      expect(beforeRecordsById.get(host3.id)?.fields[hostLookupFieldId]).toEqual([20]);
      expectEmptyLookup(beforeRecordsById.get(host4.id)?.fields[hostLookupFieldId]);

      const beforeVersions = await listRecordVersions(ctx, hostTable.id);
      const beforeEventCount = ctx.testContainer.eventBus.events().length;
      ctx.clearLogs();

      await ctx.updateRecord(sourceTable.id, source1.id, {
        [sourceValueFieldId]: 15,
      });
      await ctx.drainOutbox();

      const plan = ctx.getLastComputedPlan();
      expect(plan).toBeDefined();
      if (!plan) {
        throw new Error('Missing computed plan for lookup update');
      }

      expect(
        formatComputedPlanSnapshot(
          plan,
          buildMultiTableNameMaps([
            {
              id: sourceTable.id,
              name: 'LookupScopeSource',
              fields: [{ id: sourceValueFieldId, name: 'SourceValue' }],
            },
            {
              id: hostTable.id,
              name: 'LookupScopeHost',
              fields: [{ id: hostLookupFieldId, name: 'LookupValue' }],
            },
          ])
        )
      ).toMatchInlineSnapshot(`
        {
          "edgeCount": 1,
          "stepCount": 1,
          "steps": [
            {
              "fields": [
                "LookupValue",
              ],
              "level": 0,
              "table": "LookupScopeHost",
            },
          ],
        }
      `);

      const afterRecords = await ctx.listRecords(hostTable.id);
      const afterRecordsById = new Map(afterRecords.map((record) => [record.id, record]));

      expect(afterRecordsById.get(host1.id)?.fields[hostLookupFieldId]).toEqual([15]);
      expect(afterRecordsById.get(host2.id)?.fields[hostLookupFieldId]).toEqual([15]);
      expect(afterRecordsById.get(host3.id)?.fields[hostLookupFieldId]).toEqual([20]);
      expectEmptyLookup(afterRecordsById.get(host4.id)?.fields[hostLookupFieldId]);

      const afterVersions = await listRecordVersions(ctx, hostTable.id);
      expect(afterVersions.get(host1.id)).toBe((beforeVersions.get(host1.id) ?? 0) + 1);
      expect(afterVersions.get(host2.id)).toBe((beforeVersions.get(host2.id) ?? 0) + 1);
      expect(afterVersions.get(host3.id)).toBe(beforeVersions.get(host3.id));
      expect(afterVersions.get(host4.id)).toBe(beforeVersions.get(host4.id));

      const newEvents = ctx.testContainer.eventBus.events().slice(beforeEventCount);
      const computedBatchEvents = newEvents.filter(
        (event): event is RecordsBatchUpdated =>
          event instanceof RecordsBatchUpdated &&
          event.source === 'computed' &&
          event.tableId.toString() === hostTable.id
      );

      expect(computedBatchEvents.length).toBeGreaterThan(0);

      const updatedRecordIds = new Set(
        computedBatchEvents.flatMap((event) => event.updates.map((update) => update.recordId))
      );
      expect([...updatedRecordIds].sort()).toStrictEqual([host1.id, host2.id].sort());

      const changedFieldIds = new Set(
        computedBatchEvents.flatMap((event) =>
          event.updates.flatMap((update) => update.changes.map((change) => change.fieldId))
        )
      );
      expect([...changedFieldIds]).toStrictEqual([hostLookupFieldId]);
    } finally {
      await deleteTableSafe(ctx, hostTableId);
      await deleteTableSafe(ctx, sourceTableId);
    }
  });
});
