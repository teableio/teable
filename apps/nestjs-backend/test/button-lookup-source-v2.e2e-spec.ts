import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable/core';
import { axios } from '@teable/openapi';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('V2 button lookup source eligibility (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const tableIds: string[] = [];
  const previousForceV2 = process.env.FORCE_V2_ALL;

  beforeAll(async () => {
    process.env.FORCE_V2_ALL = 'true';
    app = (await initApp()).app;
  });

  afterAll(async () => {
    try {
      for (const tableId of tableIds.reverse()) {
        await permanentDeleteTable(baseId, tableId);
      }
      await app?.close();
    } finally {
      if (previousForceV2 == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2;
    }
  });

  it.each([
    { conditional: false, operation: 'create' },
    { conditional: true, operation: 'create' },
    { conditional: false, operation: 'update' },
    { conditional: true, operation: 'update' },
  ])(
    'rejects button source: conditional=$conditional operation=$operation',
    async ({ conditional, operation }) => {
      const source = await createTable(baseId, {
        name: 'Eligibility source',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Amount', type: FieldType.Number },
          { name: 'Action', type: FieldType.Button, options: { label: 'Run', color: 'blue' } },
        ],
        records: [{ fields: { Name: 'Item', Amount: 10 } }],
      });
      tableIds.push(source.id);
      const primary = source.fields.find((field) => field.name === 'Name')!;
      const amount = source.fields.find((field) => field.name === 'Amount')!;
      const button = source.fields.find((field) => field.name === 'Action')!;
      expect(primary).toMatchObject({ type: FieldType.SingleLineText, isPrimary: true });
      expect(amount).toMatchObject({ type: FieldType.Number });
      expect(button).toMatchObject({ type: FieldType.Button });

      const host = await createTable(baseId, {
        name: 'Eligibility host',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          {
            name: 'Source',
            type: FieldType.Link,
            options: { relationship: Relationship.ManyMany, foreignTableId: source.id },
          },
        ],
        records: [{ fields: { Name: 'Entry' } }],
      });
      tableIds.push(host.id);
      const link = host.fields.find((field) => field.name === 'Source')!;
      expect(link).toMatchObject({
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: source.id },
      });
      const lookupOptions = {
        foreignTableId: source.id,
        ...(conditional
          ? {
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: amount.id, operator: 'isGreater', value: 0 }],
              },
            }
          : { linkFieldId: link.id }),
      };
      const payload = (sourceField: typeof button) => ({
        name: 'Values',
        type: sourceField.type,
        isLookup: true,
        ...(conditional ? { isConditionalLookup: true } : {}),
        lookupOptions: { ...lookupOptions, lookupFieldId: sourceField.id },
      });
      let lookupId: string | undefined;
      if (operation === 'update') {
        const valid = await axios.post(`/table/${host.id}/field`, payload(amount));
        expect(valid.status).toBe(201);
        expect(valid.headers['x-teable-v2']).toBe('true');
        lookupId = valid.data.id;
      }
      const before = await axios.get(`/table/${host.id}/field`);
      const response = await axios.request({
        method: operation === 'create' ? 'POST' : 'PUT',
        url:
          operation === 'create'
            ? `/table/${host.id}/field`
            : `/table/${host.id}/field/${lookupId}/convert`,
        data: payload(button),
        validateStatus: () => true,
      });
      expect(response.headers['x-teable-v2']).toBe('true');
      expect(response.status, JSON.stringify(response.data)).toBe(400);
      expect(JSON.stringify(response.data)).toContain(
        'Button fields cannot be used as a lookup source'
      );
      expect((await axios.get(`/table/${host.id}/field`)).data).toEqual(before.data);
    }
  );
});
