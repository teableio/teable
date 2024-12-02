import type { INestApplication } from '@nestjs/common';
import type { ITableFullVo } from '@teable/openapi';
import { getRecords as apiGetRecords, createField } from '@teable/openapi';
import { x_20 } from './data-helpers/20x';
import { x_20_link, x_20_link_from_lookups } from './data-helpers/20x-link';
import { createTable, permanentDeleteTable, initApp, getFields } from './utils/init-app';

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
    let subTable: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });

      const x20Link = x_20_link(table);
      subTable = await createTable(baseId, {
        name: 'sort_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      });

      const x20LinkFromLookups = x_20_link_from_lookups(table, subTable.fields[2].id);
      for (const field of x20LinkFromLookups.fields) {
        await createField(subTable.id, field);
      }

      table.fields = await getFields(table.id);
      subTable.fields = await getFields(subTable.id);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, subTable.id);
    });

    describe('simple search fields', () => {
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
              search: [queryValue, fieldId, true],
            })
          ).data;

          // console.log('records', records);
          expect(records.length).toBe(expectResultLength);
        }
      );
    });

    describe('advanced search fields', () => {
      test.each([
        {
          tableName: 'table',
          fieldIndex: 9,
          queryValue: 'B-18',
          expectResultLength: 6,
        },
        {
          tableName: 'table',
          fieldIndex: 9,
          queryValue: '"',
          expectResultLength: 0,
        },
        {
          tableName: 'subTable',
          fieldIndex: 4,
          queryValue: '20.0',
          expectResultLength: 1,
        },
        {
          tableName: 'subTable',
          fieldIndex: 5,
          queryValue: 'z',
          expectResultLength: 1,
        },
        {
          tableName: 'subTable',
          fieldIndex: 6,
          queryValue: '2020',
          expectResultLength: 5,
        },
        {
          tableName: 'subTable',
          fieldIndex: 8,
          queryValue: 'test',
          expectResultLength: 5,
        },
        {
          tableName: 'subTable',
          fieldIndex: 9,
          queryValue: 'rap, rock, hiphop',
          expectResultLength: 6,
        },
        {
          tableName: 'subTable',
          fieldIndex: 10,
          queryValue: 'test_1, test_1',
          expectResultLength: 3,
        },
      ])(
        'should search $tableName value: $queryValue in field: $fieldIndex, expect result length: $expectResultLength',
        async ({ tableName, fieldIndex, queryValue, expectResultLength }) => {
          const curTable = tableName === 'table' ? table : subTable;
          const viewId = curTable.views[0].id;
          const field = curTable.fields[fieldIndex];

          // console.log('currentField:', JSON.stringify(field, null, 2));

          const { records } = (
            await apiGetRecords(curTable.id, {
              viewId,
              search: [queryValue, field.id, true],
            })
          ).data;

          // console.log(
          //   'records',
          //   records.map((r) => r.fields[field.name])
          // );
          expect(records.length).toBe(expectResultLength);
        }
      );
    });
  });
});
