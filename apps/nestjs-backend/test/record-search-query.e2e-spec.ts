import type { INestApplication } from '@nestjs/common';
import type { ITableFullVo } from '@teable/openapi';
import { getRecords as apiGetRecords } from '@teable/openapi';
import { x_20 } from './data-helpers/20x';
import { createTable, deleteTable, initApp } from './utils/init-app';

describe('OpenAPI Record-Search-Query (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('basis field search record', () => {
    let table: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });
    });

    afterAll(async () => {
      await deleteTable(baseId, table.id);
    });

    describe.only('simple search fields', () => {
      test.each([
        {
          fieldIndex: 0,
          queryValue: 'field 19',
          expectResultLength: 1,
        },
        {
          fieldIndex: 1,
          queryValue: '19',
          expectResultLength: 1,
        },
        {
          fieldIndex: 1,
          queryValue: '19.0',
          expectResultLength: 1,
        },
        {
          fieldIndex: 1,
          queryValue: '19.00',
          expectResultLength: 0,
        },
        {
          fieldIndex: 2,
          queryValue: 'Z',
          expectResultLength: 2,
        },
        {
          fieldIndex: 3,
          queryValue: '2022-03-02',
          expectResultLength: 1,
        },
        {
          fieldIndex: 3,
          queryValue: '2022-02-28',
          expectResultLength: 0,
        },
        {
          fieldIndex: 4,
          queryValue: 'true',
          expectResultLength: 23,
        },
        {
          fieldIndex: 5,
          queryValue: 'test',
          expectResultLength: 1,
        },
        {
          fieldIndex: 6,
          queryValue: 'hiphop',
          expectResultLength: 5,
        },
        {
          fieldIndex: 7,
          queryValue: 'test',
          expectResultLength: 2,
        },
        {
          fieldIndex: 7,
          queryValue: '"',
          expectResultLength: 0,
        },
        {
          fieldIndex: 8,
          queryValue: '2.1',
          expectResultLength: 23,
        },
      ])(
        'should search value: $queryValue in field: $fieldIndex, expect result length: $expectResultLength',
        async ({ fieldIndex, queryValue, expectResultLength }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;

          const { records } = (
            await apiGetRecords(tableId, {
              viewId,
              search: [fieldId, queryValue],
            })
          ).data;

          // console.log('records', records);
          expect(records.length).toBe(expectResultLength);
        }
      );
    });
  });
});
