/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('create-field: lookup v1 parity', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('lookup keeps relationship and marks hasError after link converted', async () => {
    let table1Id: string | undefined;
    let table2Id: string | undefined;

    try {
      const table2 = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-lookup-foreign'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      table2Id = table2.id;
      const table2PrimaryId = table2.fields.find((f) => f.isPrimary)?.id;
      if (!table2PrimaryId) throw new Error('Missing foreign primary field');
      const foreignRecord = await ctx.createRecord(table2.id, { [table2PrimaryId]: 'x' });

      const table1 = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-lookup-host'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      table1Id = table1.id;
      const hostRecord = await ctx.createRecord(table1.id, { Name: 'host' });

      const tableWithLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table1.id,
        field: {
          type: 'link',
          name: 'Link',
          options: {
            relationship: 'manyOne',
            foreignTableId: table2.id,
            lookupFieldId: table2PrimaryId,
            isOneWay: true,
          },
        },
      });
      const linkField = tableWithLink.fields.find((f) => f.name === 'Link');
      if (!linkField) throw new Error('Missing link field');

      const tableWithLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table1.id,
        field: {
          type: 'lookup',
          name: 'LookupName',
          options: {
            linkFieldId: linkField.id,
            foreignTableId: table2.id,
            lookupFieldId: table2PrimaryId,
          },
        },
      });
      const lookupField = tableWithLookup.fields.find((f) => f.name === 'LookupName');
      if (!lookupField) throw new Error('Missing lookup field');

      await ctx.updateRecord(table1.id, hostRecord.id, {
        [linkField.id]: { id: foreignRecord.id },
      });
      await ctx.drainOutbox();

      await ctx.updateField({
        tableId: table1.id,
        fieldId: linkField.id,
        field: {
          type: 'singleLineText',
          options: {},
        },
      });
      await ctx.drainOutbox();

      const refreshed = await ctx.getTableById(table1.id);
      const lookupAfter = refreshed.fields.find((f) => f.id === lookupField.id) as
        | { hasError?: boolean; lookupOptions?: { relationship?: string } }
        | undefined;
      expect(lookupAfter?.hasError).toBe(true);
      expect(lookupAfter?.lookupOptions?.relationship).toBe('manyMany');
    } finally {
      if (table1Id) await ctx.deleteTable(table1Id).catch(() => undefined);
      if (table2Id) await ctx.deleteTable(table2Id).catch(() => undefined);
    }
  });
});
