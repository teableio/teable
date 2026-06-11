/* eslint-disable @typescript-eslint/naming-convention */
import { createBaseOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('create-field: lookup cross-base', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;
  let fieldIdCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;
  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createBase = async (name: string) => {
    const response = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, spaceId: 'space_test' }),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateBase failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createBaseOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`CreateBase parse failed: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.base.id;
  };

  const deleteTableWithBaseId = async (baseId: string, tableId: string) => {
    const response = await fetch(`${ctx.baseUrl}/tables/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId, tableId, mode: 'permanent' }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete table ${tableId} in base ${baseId}: ${errorText}`);
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('creates lookup through one-way cross-base link', async () => {
    let hostTableId: string | undefined;
    let foreignBaseId: string | undefined;
    let foreignTableId: string | undefined;

    try {
      foreignBaseId = await createBase(nextName('v2-create-lookup-foreign-base'));

      const foreignPrimaryFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: foreignBaseId,
        name: nextName('v2-create-lookup-foreign-table'),
        fields: [{ type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Product Name' }],
      });
      foreignTableId = foreignTable.id;

      const foreignRecord = await ctx.createRecord(foreignTable.id, {
        [foreignPrimaryFieldId]: 'Prod-A',
      });

      const hostPrimaryFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-lookup-host-table'),
        fields: [{ type: 'singleLineText', id: hostPrimaryFieldId, name: 'Order Name' }],
      });
      hostTableId = hostTable.id;

      const linkFieldName = 'Product Link';
      const tableAfterLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          id: createFieldId(),
          name: linkFieldName,
          options: {
            baseId: foreignBaseId,
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: true,
          },
        },
      });
      const linkFieldId = tableAfterLink.fields.find((field) => field.name === linkFieldName)?.id;
      if (!linkFieldId) {
        throw new Error('Failed to resolve created link field');
      }

      const lookupFieldId = createFieldId();
      const tableAfterLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'lookup',
          id: lookupFieldId,
          name: 'Product Name (Lookup)',
          options: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
          },
        },
      });
      const lookupField = tableAfterLookup.fields.find((field) => field.id === lookupFieldId) as
        | { isLookup?: boolean; lookupOptions?: unknown }
        | undefined;
      expect(lookupField?.isLookup).toBe(true);
      expect(lookupField?.lookupOptions).toBeTruthy();

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Order-1',
      });

      await ctx.updateRecord(hostTable.id, hostRecord.id, {
        [linkFieldId]: { id: foreignRecord.id },
      });

      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecords(hostTable.id);
      const updatedHostRecord = hostRecords.find((record) => record.id === hostRecord.id);
      expect(updatedHostRecord?.fields[lookupFieldId]).toEqual(['Prod-A']);
    } finally {
      await ctx.drainOutbox().catch(() => undefined);
      if (hostTableId) {
        await ctx.deleteTable(hostTableId).catch(() => undefined);
      }
      if (foreignBaseId && foreignTableId) {
        await deleteTableWithBaseId(foreignBaseId, foreignTableId).catch(() => undefined);
      }
    }
  });
});
