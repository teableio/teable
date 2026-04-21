/* eslint-disable @typescript-eslint/naming-convention */
import { createBaseOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http deleteField cross-base (e2e)', () => {
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

  it('deletes a lookup field created through a one-way cross-base link', async () => {
    let hostTableId: string | undefined;
    let foreignBaseId: string | undefined;
    let foreignTableId: string | undefined;

    try {
      foreignBaseId = await createBase(nextName('v2-delete-lookup-foreign-base'));

      const foreignPrimaryFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: foreignBaseId,
        name: nextName('v2-delete-lookup-foreign-table'),
        fields: [{ type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Product Name' }],
      });
      foreignTableId = foreignTable.id;

      const hostPrimaryFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-delete-lookup-host-table'),
        fields: [{ type: 'singleLineText', id: hostPrimaryFieldId, name: 'Order Name' }],
      });
      hostTableId = hostTable.id;

      const linkFieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          id: linkFieldId,
          name: 'Product Link',
          options: {
            baseId: foreignBaseId,
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: true,
          },
        },
      });

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
      expect(tableAfterLookup.fields.some((field) => field.id === lookupFieldId)).toBe(true);

      await ctx.deleteField({ tableId: hostTable.id, fieldId: lookupFieldId });

      const hostAfterDelete = await ctx.getTableById(hostTable.id);
      expect(hostAfterDelete.fields.some((field) => field.id === lookupFieldId)).toBe(false);
    } finally {
      if (hostTableId) {
        await ctx.deleteTable(hostTableId).catch(() => undefined);
      }
      if (foreignBaseId && foreignTableId) {
        await deleteTableWithBaseId(foreignBaseId, foreignTableId).catch(() => undefined);
      }
    }
  });
});
