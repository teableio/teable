/* eslint-disable @typescript-eslint/naming-convention */
import { createBaseOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('create-field: conditionalLookup cross-base', () => {
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
      body: JSON.stringify({ baseId, tableId }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete table ${tableId} in base ${baseId}: ${errorText}`);
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('creates conditional lookup across base boundaries', async () => {
    let hostTableId: string | undefined;
    let foreignBaseId: string | undefined;
    let foreignTableId: string | undefined;

    try {
      foreignBaseId = await createBase(nextName('v2-create-cl-foreign-base'));

      const foreignNameFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: foreignBaseId,
        name: nextName('v2-create-cl-foreign-table'),
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        records: [
          { fields: { [foreignNameFieldId]: 'Item-A', [foreignStatusFieldId]: 'Active' } },
          { fields: { [foreignNameFieldId]: 'Item-B', [foreignStatusFieldId]: 'Inactive' } },
          { fields: { [foreignNameFieldId]: 'Item-C', [foreignStatusFieldId]: 'Active' } },
        ],
      });
      foreignTableId = foreignTable.id;

      const hostPrimaryFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-cl-host-table'),
        fields: [{ type: 'singleLineText', id: hostPrimaryFieldId, name: 'Host Name' }],
        records: [{ fields: { [hostPrimaryFieldId]: 'Host-1' } }],
      });
      hostTableId = hostTable.id;

      const conditionalLookupFieldId = createFieldId();
      const updatedTable = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'conditionalLookup',
          id: conditionalLookupFieldId,
          name: 'Active Items',
          options: {
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignNameFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: foreignStatusFieldId, operator: 'is', value: 'Active' }],
              },
            },
          },
        },
      });

      const createdField = updatedTable.fields.find(
        (field) => field.id === conditionalLookupFieldId
      ) as { isLookup?: boolean; conditionalLookupOptions?: unknown } | undefined;
      expect(createdField?.isLookup).toBe(true);
      expect(createdField?.conditionalLookupOptions).toBeTruthy();

      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecords(hostTable.id);
      expect(hostRecords[0]?.fields[conditionalLookupFieldId]).toEqual(['Item-A', 'Item-C']);
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
