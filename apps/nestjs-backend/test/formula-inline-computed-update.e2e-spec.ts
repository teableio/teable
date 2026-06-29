/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ISelectFieldOptionsRo } from '@teable/core';
import { Colors, FieldKeyType, FieldType } from '@teable/core';
import { updateRecord as apiUpdateRecord } from '@teable/openapi';
import {
  createField,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';
import { X_TEABLE_V2_HEADER } from '../src/features/canary/interceptors/v2-indicator.interceptor';

const isForceV2 = process.env.FORCE_V2_ALL === 'true';
const describeV2 = isForceV2 ? describe : describe.skip;

describeV2('Formula inline computed updates (v2 e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the updated same-record formula value in the PATCH response', async () => {
    const table = await createTable(baseId, {
      name: `formula_inline_update_${Date.now()}`,
      fields: [
        {
          name: 'Commission Valid',
          type: FieldType.SingleSelect,
          options: {
            choices: [
              { name: 'Yes', color: Colors.Green },
              { name: 'No', color: Colors.Red },
            ],
          } as ISelectFieldOptionsRo,
        },
        { name: 'Price', type: FieldType.Number },
        {
          name: 'Order Type',
          type: FieldType.SingleSelect,
          options: {
            choices: [
              { name: 'New', color: Colors.Blue },
              { name: 'Renewal', color: Colors.Yellow },
            ],
          } as ISelectFieldOptionsRo,
        },
      ] as IFieldRo[],
      records: [
        {
          fields: {
            'Commission Valid': 'Yes',
            Price: 480,
            'Order Type': 'New',
          },
        },
      ],
    });

    try {
      const commissionValidFieldId = table.fields.find(
        (field) => field.name === 'Commission Valid'
      )!.id;
      const priceFieldId = table.fields.find((field) => field.name === 'Price')!.id;
      const orderTypeFieldId = table.fields.find((field) => field.name === 'Order Type')!.id;

      const commissionField = await createField(table.id, {
        name: 'Commission',
        type: FieldType.Formula,
        options: {
          expression: `IF({${commissionValidFieldId}} = "No", 0, IF({${priceFieldId}} > 0, ROUND(IF({${orderTypeFieldId}} = "New", {${priceFieldId}} * 0.15, {${priceFieldId}} * 0.10), 2), 0))`,
        },
      } as IFieldRo);

      const recordId = table.records[0].id;
      const initialRecord = await getRecord(table.id, recordId);
      expect(initialRecord.fields[commissionField.id]).toBe(72);

      const response = await apiUpdateRecord(table.id, recordId, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [commissionValidFieldId]: 'No',
          },
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.data.fields[commissionValidFieldId]).toBe('No');
      expect(response.data.fields[commissionField.id]).toBe(0);
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});
