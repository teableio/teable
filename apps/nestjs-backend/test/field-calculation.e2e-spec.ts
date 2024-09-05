import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { FieldType, NumberFormattingType } from '@teable/core';
import type { IRecordsVo } from '@teable/openapi';
import {
  createField,
  createTable,
  permanentDeleteTable,
  getFields,
  getRecords,
  initApp,
  updateRecordByApi,
} from './utils/init-app';
import { seeding } from './utils/record-mock';

describe('OpenAPI Field calculation (e2e)', () => {
  let app: INestApplication;
  let tableId = '';
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    tableId = (await createTable(baseId, { name: 'table1' })).id;

    await seeding(tableId, 1000);
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, tableId);
    await app.close();
  });

  it('should calculate when add a non-reference formula field', async () => {
    const fieldRo: IFieldRo = {
      name: 'New formula field',
      type: FieldType.Formula,
      options: {
        expression: '1 + 1',
        formatting: {
          type: NumberFormattingType.Decimal,
          precision: 2,
        },
      },
    };

    const fieldVo: IFieldVo = await createField(tableId, fieldRo);
    const recordsVo: IRecordsVo = await getRecords(tableId);

    const equal = recordsVo.records.every((record) => record.fields[fieldVo.name] === 2);
    expect(equal).toBeTruthy();
  });

  it('should calculate when add a referenced formula field', async () => {
    const fieldsVo = await getFields(tableId);
    const recordsVo = await getRecords(tableId);

    await updateRecordByApi(tableId, recordsVo.records[0].id, fieldsVo[0].id, 'A1');
    await updateRecordByApi(tableId, recordsVo.records[1].id, fieldsVo[0].id, 'A2');
    await updateRecordByApi(tableId, recordsVo.records[2].id, fieldsVo[0].id, 'A3');

    const fieldRo: IFieldRo = {
      name: 'New formula field',
      type: FieldType.Formula,
      options: {
        expression: `{${fieldsVo[0].id}}`,
      },
    };

    const fieldVo: IFieldVo = await createField(tableId, fieldRo);
    const recordsVoAfter = await getRecords(tableId);

    expect(recordsVoAfter.records[0].fields[fieldVo.name]).toEqual('A1');
    expect(recordsVoAfter.records[1].fields[fieldVo.name]).toEqual('A2');
    expect(recordsVoAfter.records[2].fields[fieldVo.name]).toEqual('A3');
  });
});
