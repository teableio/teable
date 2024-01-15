/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, type ITableFullVo } from '@teable-group/core';
import { deleteTableArbitrary, getRecords } from '@teable-group/openapi';
import { initApp, createTable, createField } from './utils/init-app';
import { seeding } from './utils/record-mock';

describe('Test Scheduled Computing', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    table = await createTable(baseId, { name: 'table1', records: [] });
    await seeding(table.id, 10_000);
  }, 100_000);

  afterEach(async () => {
    await deleteTableArbitrary(baseId, table.id);
    console.log('clear table: ', table.id);
  });

  it('should create formula field with 10000 rows scheduled', async () => {
    const formulaFieldRo = {
      name: 'formula',
      type: FieldType.Formula,
      options: {
        expression: `{${table.fields[0].id}} & (1 + 1)`,
      },
    };

    const formulaField = await createField(table.id, formulaFieldRo);
    const result = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 10,
    });
    expect(result.data.records[0].fields[formulaField.id]).toBeTruthy();
  }, 1_000_000);
});
