import type { INestApplication } from '@nestjs/common';
import type { IGetRecordsRo, ITableFullVo } from '@teable/openapi';
import { Colors, FieldKeyType, FieldType } from '@teable/core';
import { createTable, getRecords, initApp, permanentDeleteTable } from './utils/init-app';

describe('Record unary filter operators (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let table: ITableFullVo;
  let statusFieldId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    table = await createTable(baseId, {
      name: 'Unary Filter Table',
      fields: [
        {
          name: 'Name',
          type: FieldType.SingleLineText,
        },
        {
          name: 'Status',
          type: FieldType.SingleSelect,
          options: {
            choices: [
              { id: 'opt_day0', name: 'Day0 sent', color: Colors.Blue },
              { id: 'opt_pending', name: 'Pending', color: Colors.Gray },
            ],
          },
        },
      ],
      records: [
        {
          fields: {
            Name: 'Has Status',
            Status: 'Day0 sent',
          },
        },
        {
          fields: {
            Name: 'No Status',
            Status: null,
          },
        },
      ],
    });

    statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
    if (!statusFieldId) {
      throw new Error('Status field not found');
    }
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
    await app.close();
  });

  it('should allow isNotEmpty without value on singleSelect', async () => {
    const query = {
      fieldKeyType: FieldKeyType.Id,
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusFieldId,
            operator: 'isNotEmpty',
          },
        ],
      },
    } as unknown as IGetRecordsRo;

    const result = await getRecords(table.id, query);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.fields?.[statusFieldId]).toBe('Day0 sent');
  });

  it('should allow isEmpty without value on singleSelect', async () => {
    const query = {
      fieldKeyType: FieldKeyType.Id,
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusFieldId,
            operator: 'isEmpty',
          },
        ],
      },
    } as unknown as IGetRecordsRo;

    const result = await getRecords(table.id, query);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.fields?.[statusFieldId] ?? null).toBeNull();
  });
});
