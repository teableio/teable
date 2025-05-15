import type { INestApplication } from '@nestjs/common';
import { CellValueType, DriverClient, FieldKeyType, FieldType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  getRecords as apiGetRecords,
  createField,
  toggleTableIndex,
  getTableActivatedIndex,
  TableIndex,
  getTableAbnormalIndex,
  repairTableIndex,
  deleteField,
  updateField,
  convertField,
} from '@teable/openapi';
import { differenceWith } from 'lodash';
import type { IFieldInstance } from '../src/features/field/model/factory';
import { x_20 } from './data-helpers/20x';
import { x_20_link, x_20_link_from_lookups } from './data-helpers/20x-link';
import {
  createTable,
  permanentDeleteTable,
  initApp,
  getFields,
  getTableIndexService,
} from './utils/init-app';

const getSearchIndexName = (tableDbName: string, dbFieldName: string, fieldId: string) => {
  const maxTableDbNameLen = 63 - fieldId.length - 3 - 'idx_trgm'.length;
  const tableDbNameLen =
    maxTableDbNameLen < tableDbName.length ? maxTableDbNameLen : tableDbName.length;
  const maxDbFieldNameLen = 63 - tableDbNameLen - fieldId.length - 3 - 'idx_trgm'.length;
  return `idx_trgm_${tableDbName.slice(0, tableDbNameLen)}_${dbFieldName.slice(0, maxDbFieldNameLen)}_${fieldId}`;
};

describe('OpenAPI Record-Search-Query (e2e)', async () => {
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
              fieldKeyType: FieldKeyType.Id,
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
          fieldIndex: x_20.fields.length,
          queryValue: 'B-18',
          expectResultLength: 6,
        },
        {
          tableName: 'table',
          fieldIndex: x_20.fields.length,
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
          queryValue: 'hiphop',
          expectResultLength: 7,
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
              fieldKeyType: FieldKeyType.Id,
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

  describe.skipIf(globalThis.testConfig.driver === DriverClient.Sqlite)(
    'search index relative',
    () => {
      let table: ITableFullVo;
      let tableName: string;
      beforeEach(async () => {
        table = await createTable(baseId, {
          name: 'record_query_x_20',
          fields: x_20.fields,
          records: x_20.records,
        });
        tableName = table?.dbTableName?.split('.').pop() as string;
      });

      afterEach(async () => {
        await permanentDeleteTable(baseId, table.id);
      });

      it('should create trgm index', async () => {
        await toggleTableIndex(baseId, table.id, { type: TableIndex.search });
        const result = await getTableActivatedIndex(baseId, table.id);
        expect(result.data.includes(TableIndex.search)).toBe(true);
        await toggleTableIndex(baseId, table.id, { type: TableIndex.search });
        const result2 = await getTableActivatedIndex(baseId, table.id);
        expect(result2.data.includes(TableIndex.search)).toBe(false);
      });

      it('should get abnormal index list', async () => {
        const textfield = table.fields.find(
          (f) => f.cellValueType === CellValueType.String
        )! as IFieldInstance;
        // enable search index
        await toggleTableIndex(baseId, table.id, { type: TableIndex.search });

        // delete or update abnormal index
        const tableIndexService = await getTableIndexService(app);
        await tableIndexService.deleteSearchFieldIndex(table.id, textfield);

        // expect get the abnormal list
        const result = await getTableAbnormalIndex(baseId, table.id, TableIndex.search);
        expect(result.data.length).toBe(1);
        expect(result.data[0]).toEqual({
          indexName: getSearchIndexName(tableName, textfield.dbFieldName, textfield.id),
        });
      });

      it('should repair abnormal index', async () => {
        const textfield = table.fields.find(
          (f) => f.cellValueType === CellValueType.String
        )! as IFieldInstance;
        // enable search index
        await toggleTableIndex(baseId, table.id, { type: TableIndex.search });

        // delete or update abnormal index
        const tableIndexService = await getTableIndexService(app);
        await tableIndexService.deleteSearchFieldIndex(table.id, textfield);

        // expect get the abnormal list
        const result = await getTableAbnormalIndex(baseId, table.id, TableIndex.search);
        expect(result.data.length).toBe(1);
        expect(result.data[0]).toEqual({
          indexName: getSearchIndexName(tableName, textfield.dbFieldName, textfield.id),
        });

        await repairTableIndex(baseId, table.id, TableIndex.search);

        const result2 = await getTableAbnormalIndex(baseId, table.id, TableIndex.search);
        expect(result2.data.length).toBe(0);
      });

      // field relative operator with table index
      it('should delete recoding field index when delete field', async () => {
        const textfield = table.fields.find(
          (f) => f.cellValueType === CellValueType.String && !f.isPrimary
        )!;

        const tableIndexService = await getTableIndexService(app);
        await toggleTableIndex(baseId, table.id, { type: TableIndex.search });
        const index = (await tableIndexService.getIndexInfo(table.id)) as { indexname: string }[];
        await deleteField(table.id, textfield.id);
        const index2 = (await tableIndexService.getIndexInfo(table.id)) as { indexname: string }[];
        const diffIndex = differenceWith(index, index2, (a, b) => a?.indexname === b?.indexname);
        expect(diffIndex[0]?.indexname).toEqual(
          getSearchIndexName(tableName, textfield.dbFieldName, textfield.id)
        );
        const result2 = await getTableAbnormalIndex(baseId, table.id, TableIndex.search);
        expect(result2.data.length).toBe(0);
      });

      it('should create new field index automatically when field be created with table index', async () => {
        const tableIndexService = await getTableIndexService(app);
        await toggleTableIndex(baseId, table.id, { type: TableIndex.search });
        const index = (await tableIndexService.getIndexInfo(table.id)) as { indexname: string }[];
        const newField = await createField(table.id, {
          name: 'newField',
          type: FieldType.SingleLineText,
        });
        const index2 = (await tableIndexService.getIndexInfo(table.id)) as { indexname: string }[];
        const diffIndex = differenceWith(index2, index, (a, b) => a?.indexname === b?.indexname);
        expect(diffIndex[0]?.indexname).toEqual(
          getSearchIndexName(tableName, newField.data.dbFieldName, newField.data.id)
        );
        const result2 = await getTableAbnormalIndex(baseId, table.id, TableIndex.search);
        expect(result2.data.length).toBe(0);
      });

      it('should convert field index automatically when field be convert with table index', async () => {
        const textfield = table.fields.find(
          (f) => f.cellValueType === CellValueType.String && !f.isPrimary
        )!;
        const tableIndexService = await getTableIndexService(app);
        await toggleTableIndex(baseId, table.id, { type: TableIndex.search });
        const index = (await tableIndexService.getIndexInfo(table.id)) as { indexname: string }[];
        await convertField(table.id, textfield.id, {
          type: FieldType.Checkbox,
        });
        const index2 = (await tableIndexService.getIndexInfo(table.id)) as { indexname: string }[];
        const diffIndex = differenceWith(index, index2, (a, b) => a?.indexname === b?.indexname);
        expect(diffIndex[0]?.indexname).toEqual(
          getSearchIndexName(tableName, textfield.dbFieldName, textfield.id)
        );

        const result2 = await getTableAbnormalIndex(baseId, table.id, TableIndex.search);
        expect(result2.data.length).toBe(0);
      });

      it('should update index name when dbFieldName to be changed', async () => {
        const textfield = table.fields.find(
          (f) => f.cellValueType === CellValueType.String && !f.isPrimary
        )!;
        const tableIndexService = await getTableIndexService(app);
        await toggleTableIndex(baseId, table.id, { type: TableIndex.search });
        const index = (await tableIndexService.getIndexInfo(table.id)) as { indexname: string }[];
        await updateField(table.id, textfield.id, {
          dbFieldName: 'Test_Field',
        });
        const index2 = (await tableIndexService.getIndexInfo(table.id)) as { indexname: string }[];
        const diffIndex = differenceWith(index2, index, (a, b) => a?.indexname === b?.indexname);
        expect(diffIndex[0]?.indexname).toEqual(
          getSearchIndexName(tableName, 'Test_Field', textfield.id)
        );
        const result2 = await getTableAbnormalIndex(baseId, table.id, TableIndex.search);
        expect(result2.data.length).toBe(0);
      });
    }
  );
});
