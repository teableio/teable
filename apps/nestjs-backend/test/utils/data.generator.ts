import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { FieldKeyType, FieldType } from '@teable/core';
import { cloneDeep } from 'lodash';
import { FIELD_MOCK_DATA } from './field-mock';
import { createTable, initApp, createRecords, createField, getFields } from './init-app';

describe('Performance test data generator', () => {
  let app: INestApplication;
  let tableId = '';
  let fields: IFieldVo[] = [];
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    const table = await createTable(baseId, { name: 'table1' });

    tableId = table.id;
    console.log('createTable', table);
  });

  afterAll(async () => {
    await app.close();
  });

  function addRecords(count: number) {
    const records = Array.from({ length: count }).map((_, i) => {
      const value = fields.reduce<{ [fieldId: string]: unknown }>((acc, field) => {
        switch (field.type) {
          case FieldType.SingleLineText:
            acc[field.id] = 'New Record' + new Date();
            break;
          case FieldType.Number:
            acc[field.id] = i;
            break;
          case FieldType.SingleSelect:
            acc[field.id] = ['light', 'medium', 'heavy'][i % 3];
            break;
        }
        return acc;
      }, {});
      return { fields: value };
    });

    return createRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      records,
    });
  }

  it('/api/table/{tableId}/record (POST) (1000x)', async () => {
    const fieldCount = 20;
    const batchCount = 100;
    const count = 1000;

    for (let i = 0; i < fieldCount; i++) {
      const fieldRo: IFieldRo = cloneDeep(FIELD_MOCK_DATA[i % 3]);
      fieldRo.name = 'field' + i;

      await createField(tableId, fieldRo);
    }

    fields = await getFields(tableId);

    console.time(`create ${count} records`);
    for (let i = 0; i < count / batchCount; i++) {
      await addRecords(batchCount);
    }
    console.timeEnd(`create ${count} records`);
    console.log(`new table: ${tableId} created`);
  }, 1000000);
});
