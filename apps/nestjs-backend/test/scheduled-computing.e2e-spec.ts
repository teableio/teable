/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { permanentDeleteTable, getRecords } from '@teable/openapi';
import { initApp, createTable, createField, deleteField, convertField } from './utils/init-app';
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
    // await seeding(table.id, 3);
    await seeding(table.id, 10_000);
  }, 100_000);

  afterEach(async () => {
    await permanentDeleteTable(baseId, table.id);
    console.log('clear table: ', table.id);
  });

  it('should create/modify/delete formula field with 10000 rows scheduled', async () => {
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
    expect(result.data.records[1].fields[formulaField.id]).toBeTruthy();

    const newFormulaFieldRo = {
      type: FieldType.Formula,
      options: {
        expression: `2 + 2`,
      },
    };
    const newFormulaField = await convertField(table.id, formulaField.id, newFormulaFieldRo);
    const newResult = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 10,
    });
    expect(newResult.data.records[1].fields[newFormulaField.id]).toEqual(4);

    await deleteField(table.id, formulaField.id);
  }, 1_000_000);
});
