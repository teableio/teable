import type { INestApplication } from '@nestjs/common';
import type { IFieldVo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { axios } from '@teable/openapi';
import {
  createField,
  createTable,
  getField,
  getRecord,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('Rollup creation defaults (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    ({ app } = await initApp());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('conditional rollup API creation defaults', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let amountId: string;

    beforeEach(async () => {
      foreign = await createTable(baseId, {
        name: 'Items',
        fields: [
          { name: 'Label', type: FieldType.SingleLineText },
          { name: 'Amount', type: FieldType.Number },
        ],
        records: [
          { fields: { Label: 'Item A', Amount: 10 } },
          { fields: { Label: 'Item B', Amount: 20 } },
          { fields: { Label: 'Item C', Amount: 30 } },
        ],
      });
      host = await createTable(baseId, {
        name: 'Orders',
        fields: [{ name: 'Label', type: FieldType.SingleLineText }],
        records: [{ fields: { Label: 'Row A' } }],
      });
      amountId = foreign.fields[1].id;
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('T7753 defaults an omitted conditional expression to countall and computes matching rows', async () => {
      const response = await axios.post<IFieldVo>(`/table/${host.id}/field`, {
        name: 'Default count',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: amountId, operator: 'isGreater', value: 15 }],
          },
        },
      });
      expect(response.status).toBe(201);
      const field = response.data;
      expect(field.options).toMatchObject({ expression: 'countall({values})' });
      expect((await getField(host.id, field.id)).options).toMatchObject({
        expression: 'countall({values})',
      });
      expect((await getRecord(host.id, host.records[0].id)).fields[field.id]).toBe(2);
    });

    it('T7744 uses the legacy conditional default name while preserving other computed defaults', async () => {
      const link = await createField(host.id, {
        type: FieldType.Link,
        options: { foreignTableId: foreign.id, relationship: Relationship.ManyMany },
      });
      const lookupOptions = {
        linkFieldId: link.id,
        foreignTableId: foreign.id,
        lookupFieldId: amountId,
      };
      const lookup = await createField(host.id, {
        type: FieldType.Number,
        isLookup: true,
        lookupOptions,
      });
      const rollup = await createField(host.id, {
        type: FieldType.Rollup,
        lookupOptions,
        options: { expression: 'sum({values})' },
      });
      const conditional = await createField(host.id, {
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'sum({values})',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: amountId, operator: 'isGreater', value: 0 }],
          },
        },
      });
      const formula = await createField(host.id, {
        type: FieldType.Formula,
        options: { expression: '1+1' },
      });
      for (const [field, name] of [
        [link, 'Items'],
        [lookup, 'Amount (from Items)'],
        [rollup, 'Amount Rollup (from Items)'],
        [conditional, 'Amount Reference (Items)'],
        [formula, 'Calculation'],
      ] as const) {
        expect(field.name).toBe(name);
        expect((await getField(host.id, field.id)).name).toBe(name);
      }
    });
  });
});
