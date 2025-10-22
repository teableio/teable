/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import {
  CellValueType,
  Colors,
  DriverClient,
  FieldKeyType,
  FieldType,
  Relationship,
  SortFunc,
} from '@teable/core';
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
  getSearchIndex,
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

          expect(records.length).toBe(expectResultLength);
        }
      );
    });
  });

  describe('basis field search highlight record', () => {
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

    it('should get records with highlight records', async () => {
      const res = (
        await apiGetRecords(table.id, {
          search: ['text field 10'],
        })
      ).data;

      expect(res.extra?.searchHitIndex?.length).toBe(2);
      expect(res.extra?.searchHitIndex).toEqual(
        expect.arrayContaining([
          { recordId: res.records[11].id, fieldId: table.fields[0].id },
          { recordId: res.records[22].id, fieldId: table.fields[0].id },
        ])
      );
    });
  });

  describe('search value with special characters', () => {
    let table: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'special_characters',
        fields: [
          {
            name: 'text',
            type: FieldType.SingleLineText,
          },
          {
            name: 'user',
            type: FieldType.User,
          },
          {
            name: 'multipleSelect',
            type: FieldType.MultipleSelect,
            options: {
              choices: [
                { id: 'choX', name: 'rap', color: Colors.Cyan },
                { id: 'choY', name: 'rock', color: Colors.Blue },
                { id: 'choZ', name: 'hiphop', color: Colors.Gray },
              ],
            },
          },
        ],
        records: [
          {
            fields: {
              text: 'notepad++',
              multipleSelect: ['rap', 'rock'],
            },
          },
        ],
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should search value with special characters', async () => {
      const { records } = (
        await apiGetRecords(table.id, {
          fieldKeyType: FieldKeyType.Id,
          viewId: table.views[0].id,
          search: ['notepad++', table.fields[0].id, true],
        })
      ).data;
      expect(records.length).toBe(1);
    });
  });

  describe('search linked record fields (#2015)', () => {
    let peopleTable: ITableFullVo;
    let projectsTable: ITableFullVo;
    let linkFieldId: string;
    let lookupFieldId: string;
    let rollupFieldId: string;
    let formulaFieldId: string;

    const computedFieldConfigs: Array<{
      label: string;
      getFieldId: () => string;
      searchValue: string;
      assertValue: (value: unknown) => void;
    }> = [
      {
        label: 'link field',
        getFieldId: () => linkFieldId,
        searchValue: 'Alice Johnson',
        assertValue: (value: unknown) => {
          expect(Array.isArray(value)).toBe(true);
          expect(value).toEqual(
            expect.arrayContaining([expect.objectContaining({ title: 'Alice Johnson' })])
          );
        },
      },
      {
        label: 'lookup field',
        getFieldId: () => lookupFieldId,
        searchValue: 'Alice Johnson',
        assertValue: (value: unknown) => {
          expect(value).toEqual(['Alice Johnson']);
        },
      },
      {
        label: 'rollup field',
        getFieldId: () => rollupFieldId,
        searchValue: '100',
        assertValue: (value: unknown) => {
          expect(value).toBe(100);
        },
      },
      {
        label: 'formula field',
        getFieldId: () => formulaFieldId,
        searchValue: 'WEBSITE REDESIGN',
        assertValue: (value: unknown) => {
          expect(value).toBe('WEBSITE REDESIGN');
        },
      },
    ];

    beforeAll(async () => {
      peopleTable = await createTable(baseId, {
        name: 'search_link_people',
        fields: [
          {
            name: 'Name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Score',
            type: FieldType.Number,
          },
        ],
        records: [
          {
            fields: {
              Name: 'Alice Johnson',
              Score: 100,
            },
          },
          {
            fields: {
              Name: 'Bob Smith',
              Score: 200,
            },
          },
        ],
      });

      projectsTable = await createTable(baseId, {
        name: 'search_link_projects',
        fields: [
          {
            name: 'Project',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Owner',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: peopleTable.id,
            },
          },
        ],
        records: [
          {
            fields: {
              Project: 'Website Redesign',
              Owner: [{ id: peopleTable.records[0].id }],
            },
          },
          {
            fields: {
              Project: 'Mobile App',
              Owner: [{ id: peopleTable.records[1].id }],
            },
          },
        ],
      });

      projectsTable.fields = await getFields(projectsTable.id);
      const projectField = projectsTable.fields.find((field) => field.name === 'Project')!;
      linkFieldId = projectsTable.fields.find((field) => field.type === FieldType.Link)!.id;

      const peopleNameField = peopleTable.fields.find((field) => field.name === 'Name')!;
      const peopleScoreField = peopleTable.fields.find((field) => field.name === 'Score')!;

      const ownerLookupField = await createField(projectsTable.id, {
        name: 'Owner Name Lookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: peopleTable.id,
          lookupFieldId: peopleNameField.id,
          linkFieldId,
        },
      });

      const ownerRollupField = await createField(projectsTable.id, {
        name: 'Owner Score Total',
        type: FieldType.Rollup,
        options: {
          expression: 'sum({values})',
        },
        lookupOptions: {
          foreignTableId: peopleTable.id,
          lookupFieldId: peopleScoreField.id,
          linkFieldId,
        },
      });

      const ownerFormulaField = await createField(projectsTable.id, {
        name: 'Owner Uppercase',
        type: FieldType.Formula,
        options: {
          expression: `UPPER({${projectField.id}})`,
        },
      });

      lookupFieldId = ownerLookupField.data.id;
      rollupFieldId = ownerRollupField.data.id;
      formulaFieldId = ownerFormulaField.data.id;

      projectsTable.fields = await getFields(projectsTable.id);

      await toggleTableIndex(baseId, projectsTable.id, { type: TableIndex.search });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, projectsTable.id);
      await permanentDeleteTable(baseId, peopleTable.id);
    });

    describe('get records search results', () => {
      const recordTestCases = computedFieldConfigs.flatMap((config) => [
        {
          caseName: `${config.label} field search showing all rows`,
          getSearchValue: () => config.searchValue,
          getSearchFieldId: () => config.getFieldId(),
          hideNotMatch: false,
          expectedRecordCount: 2,
          expectedFieldId: () => config.getFieldId(),
          assertValue: config.assertValue,
        },
        {
          caseName: `${config.label} field search hiding non-matching rows`,
          getSearchValue: () => config.searchValue,
          getSearchFieldId: () => config.getFieldId(),
          hideNotMatch: true,
          expectedRecordCount: 1,
          expectedFieldId: () => config.getFieldId(),
          assertValue: config.assertValue,
        },
        {
          caseName: `${config.label} global search showing all rows`,
          getSearchValue: () => config.searchValue,
          getSearchFieldId: () => '',
          hideNotMatch: false,
          expectedRecordCount: 2,
          expectedFieldId: () => config.getFieldId(),
          assertValue: config.assertValue,
        },
        {
          caseName: `${config.label} global search hiding non-matching rows`,
          getSearchValue: () => config.searchValue,
          getSearchFieldId: () => '',
          hideNotMatch: true,
          expectedRecordCount: 1,
          expectedFieldId: () => config.getFieldId(),
          assertValue: config.assertValue,
        },
      ]);

      test.each(recordTestCases)(
        'returns expected records for %s',
        async ({
          getSearchValue,
          getSearchFieldId,
          hideNotMatch,
          expectedRecordCount,
          expectedFieldId,
          assertValue,
        }) => {
          const searchTuple: [string, string, boolean] = [
            getSearchValue(),
            getSearchFieldId(),
            hideNotMatch,
          ];

          const { records } = (
            await apiGetRecords(projectsTable.id, {
              fieldKeyType: FieldKeyType.Id,
              viewId: projectsTable.views[0].id,
              search: searchTuple,
            })
          ).data;

          const matchedRecord = records.find((record) => record.id === projectsTable.records[0].id);
          expect(matchedRecord).toBeDefined();
          assertValue(matchedRecord?.fields[expectedFieldId()] as unknown);
          expect(records.length).toBe(expectedRecordCount);
        }
      );
    });

    describe('search index results', () => {
      const searchIndexTestCases = computedFieldConfigs.flatMap((config) => [
        {
          caseName: `${config.label} field search showing all rows`,
          getSearchValue: () => config.searchValue,
          getSearchFieldId: () => config.getFieldId(),
          hideNotMatch: false,
          expectedFieldId: () => config.getFieldId(),
        },
        {
          caseName: `${config.label} field search hiding non-matching rows`,
          getSearchValue: () => config.searchValue,
          getSearchFieldId: () => config.getFieldId(),
          hideNotMatch: true,
          expectedFieldId: () => config.getFieldId(),
        },
        {
          caseName: `${config.label} global search showing all rows`,
          getSearchValue: () => config.searchValue,
          getSearchFieldId: () => '',
          hideNotMatch: false,
          expectedFieldId: () => config.getFieldId(),
        },
        {
          caseName: `${config.label} global search hiding non-matching rows`,
          getSearchValue: () => config.searchValue,
          getSearchFieldId: () => '',
          hideNotMatch: true,
          expectedFieldId: () => config.getFieldId(),
        },
      ]);

      test.each(searchIndexTestCases)(
        'returns expected search index entries for %s',
        async ({ getSearchValue, getSearchFieldId, hideNotMatch, expectedFieldId }) => {
          const searchTuple: [string, string, boolean] = [
            getSearchValue(),
            getSearchFieldId(),
            hideNotMatch,
          ];

          const payload = (
            await getSearchIndex(projectsTable.id, {
              viewId: projectsTable.views[0].id,
              take: 10,
              search: searchTuple,
            })
          ).data;

          expect(Array.isArray(payload)).toBe(true);
          expect(payload?.length ?? 0).toBeGreaterThan(0);
          const matches =
            payload?.filter(
              (entry) =>
                entry.recordId === projectsTable.records[0].id &&
                entry.fieldId === expectedFieldId()
            ) ?? [];
          expect(matches.length).toBeGreaterThan(0);
        }
      );
    });
  });

  describe('search value with line break', () => {
    let table: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'special_characters',
        fields: [
          {
            name: 'text',
            type: FieldType.LongText,
          },
          {
            name: 'user',
            type: FieldType.User,
          },
          {
            name: 'multipleSelect',
            type: FieldType.MultipleSelect,
            options: {
              choices: [
                { id: 'choX', name: 'rap', color: Colors.Cyan },
                { id: 'choY', name: 'rock', color: Colors.Blue },
                { id: 'choZ', name: 'hiphop', color: Colors.Gray },
              ],
            },
          },
        ],
        records: [
          {
            fields: {
              text: `hello\nnewYork, London\nlove`,
              multipleSelect: ['rap', 'rock'],
            },
          },
        ],
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should search value with line break', async () => {
      const { records } = (
        await apiGetRecords(table.id, {
          fieldKeyType: FieldKeyType.Id,
          viewId: table.views[0].id,
          search: ['hello newYork, London love', table.fields[0].id, true],
        })
      ).data;
      expect(records.length).toBe(1);
    });
  });

  describe('search quoting regressions', () => {
    let table: ITableFullVo;
    let descriptionFieldId: string;
    let groupFieldId: string;

    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'search_quoting_regression',
        fields: [
          {
            name: 'Name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Description',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Group',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { id: 'choAlpha', name: 'Alpha', color: Colors.Blue },
                { id: 'choBeta', name: 'Beta', color: Colors.Cyan },
              ],
            },
          },
        ],
        records: [
          {
            fields: {
              Name: 'Alpha row',
              Description: 'ce target',
              Group: 'Alpha',
            },
          },
          {
            fields: {
              Name: 'Beta row',
              Description: 'other value',
              Group: 'Beta',
            },
          },
        ],
      });

      const descriptionField = table.fields.find((f) => f.name === 'Description')!;
      const groupField = table.fields.find((f) => f.name === 'Group')!;
      await updateField(table.id, descriptionField.id, { dbFieldName: 'DESCRIPTION' });
      await updateField(table.id, groupField.id, { dbFieldName: 'GROUP' });

      table.fields = await getFields(table.id);
      descriptionFieldId = table.fields.find((f) => f.name === 'Description')!.id;
      groupFieldId = table.fields.find((f) => f.name === 'Group')!.id;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('returns results when searching uppercase db column', async () => {
      const response = await apiGetRecords(table.id, {
        viewId: table.views[0].id,
        fieldKeyType: FieldKeyType.Id,
        search: ['ce target', descriptionFieldId, true],
      });

      const { records } = response.data;
      expect(records.length).toBe(1);
      expect(records[0].fields[descriptionFieldId]).toBe('ce target');
    });

    it('sorts search index when single select column uses reserved name', async () => {
      const result = await getSearchIndex(table.id, {
        viewId: table.views[0].id,
        take: 10,
        search: ['ce', '', false],
        orderBy: [{ fieldId: groupFieldId, order: SortFunc.Asc }],
      });

      const payload = result.data as unknown;
      expect(Array.isArray(payload)).toBe(true);
      const entries = payload as { fieldId: string }[];
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0]?.fieldId).toBe(descriptionFieldId);
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
