/* eslint-disable @typescript-eslint/naming-convention */
import { createBaseOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('create-field: rollup cross-base', () => {
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

  it('creates rollup through one-way cross-base link', async () => {
    let hostTableId: string | undefined;
    let foreignBaseId: string | undefined;
    let foreignTableId: string | undefined;

    try {
      foreignBaseId = await createBase(nextName('v2-create-rollup-foreign-base'));

      const foreignPrimaryFieldId = createFieldId();
      const foreignAmountFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: foreignBaseId,
        name: nextName('v2-create-rollup-foreign-table'),
        fields: [
          { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Product Name' },
          { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
        ],
      });
      foreignTableId = foreignTable.id;

      const foreignRecord1 = await ctx.createRecord(foreignTable.id, {
        [foreignPrimaryFieldId]: 'Prod-A',
        [foreignAmountFieldId]: 10,
      });
      const foreignRecord2 = await ctx.createRecord(foreignTable.id, {
        [foreignPrimaryFieldId]: 'Prod-B',
        [foreignAmountFieldId]: 5,
      });

      const hostPrimaryFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-rollup-host-table'),
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
            relationship: 'manyMany',
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

      const rollupFieldId = createFieldId();
      const tableAfterRollup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'rollup',
          id: rollupFieldId,
          name: 'Total Amount',
          options: {
            expression: 'sum({values})',
            timeZone: 'utc',
          },
          config: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignAmountFieldId,
          },
        },
      });
      const rollupField = tableAfterRollup.fields.find((field) => field.id === rollupFieldId);
      expect(rollupField?.type).toBe('rollup');

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Order-1',
      });

      await ctx.updateRecord(hostTable.id, hostRecord.id, {
        [linkFieldId]: [{ id: foreignRecord1.id }, { id: foreignRecord2.id }],
      });

      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecords(hostTable.id);
      const updatedHostRecord = hostRecords.find((record) => record.id === hostRecord.id);
      expect(updatedHostRecord?.fields[rollupFieldId]).toBe(15);
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
