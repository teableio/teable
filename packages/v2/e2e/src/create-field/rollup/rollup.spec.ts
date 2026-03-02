/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('create-field: rollup v1 parity', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('create record with errored lookup and rollup fields returns undefined values', async () => {
    let table1Id: string | undefined;
    let table2Id: string | undefined;

    try {
      const table1 = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-record-host'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      table1Id = table1.id;

      const table2 = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-record-foreign'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      table2Id = table2.id;
      const table2PrimaryId = table2.fields.find((f) => f.isPrimary)?.id;
      if (!table2PrimaryId) throw new Error('Missing foreign primary');
      const foreignRecord = await ctx.createRecord(table2.id, { [table2PrimaryId]: 'f1' });

      const table2WithTarget = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table2.id,
        field: { type: 'singleLineText', name: 'ToDelete' },
      });
      const targetField = table2WithTarget.fields.find((f) => f.name === 'ToDelete');
      const foreignPrimaryId = table2WithTarget.fields.find((f) => f.isPrimary)?.id;
      if (!targetField || !foreignPrimaryId) throw new Error('Missing target/primary field');

      const table1WithLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table1.id,
        field: {
          type: 'link',
          name: 'Link',
          options: {
            relationship: 'manyOne',
            foreignTableId: table2.id,
            lookupFieldId: foreignPrimaryId,
            isOneWay: true,
          },
        },
      });
      const linkField = table1WithLink.fields.find((f) => f.name === 'Link');
      if (!linkField) throw new Error('Missing link field');

      const table1WithLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table1.id,
        field: {
          type: 'lookup',
          name: 'LookupErr',
          options: {
            linkFieldId: linkField.id,
            foreignTableId: table2.id,
            lookupFieldId: targetField.id,
          },
        },
      });
      const lookupField = table1WithLookup.fields.find((f) => f.name === 'LookupErr');
      if (!lookupField) throw new Error('Missing lookup field');

      const table1WithRollup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table1.id,
        field: {
          type: 'rollup',
          name: 'RollupErr',
          options: {
            expression: 'sum({values})',
          },
          config: {
            linkFieldId: linkField.id,
            foreignTableId: table2.id,
            lookupFieldId: targetField.id,
          },
        },
      });
      const rollupField = table1WithRollup.fields.find((f) => f.name === 'RollupErr');
      if (!rollupField) throw new Error('Missing rollup field');

      await ctx.deleteField({ tableId: table2.id, fieldId: targetField.id });

      const created = await ctx.createRecord(table1.id, {
        [linkField.id]: { id: foreignRecord.id },
      });
      await ctx.drainOutbox();

      expect(created.fields[lookupField.id]).toBeUndefined();
      expect(created.fields[rollupField.id]).toBeUndefined();
    } finally {
      if (table1Id) await ctx.deleteTable(table1Id).catch(() => undefined);
      if (table2Id) await ctx.deleteTable(table2Id).catch(() => undefined);
    }
  });
});
