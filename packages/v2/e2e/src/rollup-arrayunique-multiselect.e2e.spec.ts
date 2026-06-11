/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 rollup ARRAYUNIQUE over multi-select values (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('flattens nested multi-select values before deduplicating rollup output', async () => {
    const foreignPrimaryFieldId = createFieldId();
    const foreignTagsFieldId = createFieldId();
    const hostPrimaryFieldId = createFieldId();
    const hostLinkFieldId = createFieldId();
    const hostRollupFieldId = createFieldId();

    let foreignTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Rollup ArrayUnique Foreign',
        fields: [
          {
            type: 'singleLineText',
            id: foreignPrimaryFieldId,
            name: 'Name',
            isPrimary: true,
          },
          {
            type: 'multipleSelect',
            id: foreignTagsFieldId,
            name: 'Tags',
            options: {
              choices: [
                { id: 'optA', name: 'A', color: 'blue' },
                { id: 'optB', name: 'B', color: 'green' },
                { id: 'optC', name: 'C', color: 'red' },
              ],
            },
          },
        ],
      });
      foreignTableId = foreignTable.id;

      const foreignRecord1 = await ctx.createRecord(foreignTable.id, {
        [foreignPrimaryFieldId]: 'P1',
        [foreignTagsFieldId]: ['A', 'B'],
      });
      const foreignRecord2 = await ctx.createRecord(foreignTable.id, {
        [foreignPrimaryFieldId]: 'P2',
        [foreignTagsFieldId]: ['B'],
      });
      const foreignRecord3 = await ctx.createRecord(foreignTable.id, {
        [foreignPrimaryFieldId]: 'P3',
        [foreignTagsFieldId]: ['B', 'C'],
      });

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Rollup ArrayUnique Host',
        fields: [
          {
            type: 'singleLineText',
            id: hostPrimaryFieldId,
            name: 'Name',
            isPrimary: true,
          },
        ],
      });
      hostTableId = hostTable.id;

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          id: hostLinkFieldId,
          name: 'Projects',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: true,
          },
        },
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'rollup',
          id: hostRollupFieldId,
          name: 'Unique Tags',
          options: {
            expression: 'array_unique({values})',
          },
          config: {
            linkFieldId: hostLinkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignTagsFieldId,
          },
        },
      });

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Ops',
        [hostLinkFieldId]: [
          { id: foreignRecord1.id },
          { id: foreignRecord2.id },
          { id: foreignRecord3.id },
        ],
      });

      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecords(hostTable.id);
      const updatedHostRecord = hostRecords.find((record) => record.id === hostRecord.id);

      expect(updatedHostRecord?.fields[hostRollupFieldId]).toEqual(['A', 'B', 'C']);
    } finally {
      if (hostTableId) {
        await ctx.deleteTable(hostTableId).catch(() => undefined);
      }
      if (foreignTableId) {
        await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    }
  });
});
