import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, SortFunc } from '@teable/core';
import { createRecords, updateRecord, type ITableFullVo } from '@teable/openapi';
import { createTable, permanentDeleteTable, getRecords, initApp } from './utils/init-app';

describe('Record field key (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let table: ITableFullVo;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    table = await createTable(baseId, {
      fields: [
        {
          name: 'field1',
          dbFieldName: 'db_field1',
          type: FieldType.SingleLineText,
        },
      ],
      records: [
        {
          fields: {
            field1: 'test1',
          },
        },
        {
          fields: {
            field1: 'test2',
          },
        },
      ],
    });
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
    await app.close();
  });

  it('should get filtered records with db field name', async () => {
    const records = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.DbFieldName,
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: 'db_field1',
            operator: 'is',
            value: 'test2',
          },
        ],
      },
    });

    expect(records.records[0].fields.db_field1).toBe('test2');
  });

  it('should get sorted records with db field name', async () => {
    const records = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.DbFieldName,
      orderBy: [
        {
          fieldId: 'db_field1',
          order: SortFunc.Desc,
        },
      ],
    });

    expect(records.records[0].fields.db_field1).toBe('test2');
    expect(records.records[1].fields.db_field1).toBe('test1');
  });

  it('should get grouped records with db field name', async () => {
    const records = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.DbFieldName,
      groupBy: [{ fieldId: 'db_field1', order: SortFunc.Desc }],
    });

    expect(records.records[0].fields.db_field1).toBe('test2');
    expect(records.records[1].fields.db_field1).toBe('test1');
  });

  it('should get searched records with db field name', async () => {
    const records = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.DbFieldName,
      search: ['test2', 'db_field1', true],
    });

    expect(records.records[0].fields.db_field1).toBe('test2');
  });

  it('should update record with db field name', async () => {
    const records = await updateRecord(table.id, table.records[0].id, {
      fieldKeyType: FieldKeyType.DbFieldName,
      record: { fields: { db_field1: 'test3' } },
    });

    expect(records.data.fields.db_field1).toBe('test3');
  });

  it('should create record with db field name', async () => {
    const records = await createRecords(table.id, {
      fieldKeyType: FieldKeyType.DbFieldName,
      records: [{ fields: { db_field1: 'test4' } }],
    });

    expect(records.data.records[0].fields.db_field1).toBe('test4');
  });
});
