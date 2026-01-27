/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFilter, ILookupOptionsRo } from '@teable/core';
import {
  and,
  contains,
  doesNotContain,
  DriverClient,
  FieldKeyType,
  FieldType,
  is,
  Relationship,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  getRecords as apiGetRecords,
  getAggregation,
  StatisticsFunc,
  toggleTableIndex,
  TableIndex,
} from '@teable/openapi';
import {
  createField,
  createTable,
  permanentDeleteTable,
  initApp,
  updateRecordByApi,
} from './utils/init-app';

describe('OpenAPI Record-Filter-Query Issues (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  // T1613: Boolean formula field filter and aggregation not working correctly
  describe('T1613: boolean field filter and aggregation', () => {
    let formulaTable: ITableFullVo;
    let formulaFieldId: string;
    let checkboxTable: ITableFullVo;
    let checkboxFieldId: string;
    let lookupSourceTable: ITableFullVo;
    let lookupMainTable: ITableFullVo;
    let lookupFieldId: string;

    beforeAll(async () => {
      // Setup formula table (2 true, 2 false, 2 null)
      formulaTable = await createTable(baseId, {
        name: 'boolean_formula_test',
        fields: [{ name: 'Num', type: FieldType.Number }],
        records: [
          { fields: { Num: 5 } },
          { fields: { Num: 10 } },
          { fields: { Num: 1 } },
          { fields: { Num: 2 } },
          { fields: { Num: null } },
          { fields: {} },
        ],
      });
      const numFieldId = formulaTable.fields.find((f) => f.name === 'Num')!.id;
      const formulaField = await createField(formulaTable.id, {
        name: 'Formula',
        type: FieldType.Formula,
        options: { expression: `{${numFieldId}} > 3` },
      });
      formulaFieldId = formulaField.id;

      // Setup checkbox table (2 true, 2 null)
      checkboxTable = await createTable(baseId, {
        name: 'checkbox_test',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Check', type: FieldType.Checkbox },
        ],
        records: [
          { fields: { Check: true } },
          { fields: { Check: true } },
          { fields: { Check: null } },
          { fields: {} },
        ],
      });
      checkboxFieldId = checkboxTable.fields.find((f) => f.name === 'Check')!.id;

      // Setup lookup tables
      lookupSourceTable = await createTable(baseId, {
        name: 'lookup_source',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Check', type: FieldType.Checkbox },
        ],
        records: [
          { fields: { Check: true } },
          { fields: { Check: true } },
          { fields: { Check: null } },
          { fields: {} },
        ],
      });
      lookupMainTable = await createTable(baseId, {
        name: 'lookup_main',
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
        records: [{ fields: {} }, { fields: {} }, { fields: {} }, { fields: {} }],
      });
      const linkField = await createField(lookupMainTable.id, {
        name: 'Link',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: lookupSourceTable.id },
      } as IFieldRo);
      const checkFieldId = lookupSourceTable.fields.find((f) => f.name === 'Check')!.id;
      const lookupField = await createField(lookupMainTable.id, {
        name: 'LookupCheck',
        type: FieldType.Checkbox,
        isLookup: true,
        lookupOptions: {
          foreignTableId: lookupSourceTable.id,
          linkFieldId: linkField.id,
          lookupFieldId: checkFieldId,
        } as ILookupOptionsRo,
      } as IFieldRo);
      lookupFieldId = lookupField.id;

      // Link: [0]->A,B(true,true), [1]->C,D(null,null), [2]->A,C(true,null), [3]->none
      await updateRecordByApi(lookupMainTable.id, lookupMainTable.records[0].id, linkField.id, [
        { id: lookupSourceTable.records[0].id },
        { id: lookupSourceTable.records[1].id },
      ]);
      await updateRecordByApi(lookupMainTable.id, lookupMainTable.records[1].id, linkField.id, [
        { id: lookupSourceTable.records[2].id },
        { id: lookupSourceTable.records[3].id },
      ]);
      await updateRecordByApi(lookupMainTable.id, lookupMainTable.records[2].id, linkField.id, [
        { id: lookupSourceTable.records[0].id },
        { id: lookupSourceTable.records[2].id },
      ]);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, formulaTable.id);
      await permanentDeleteTable(baseId, checkboxTable.id);
      await permanentDeleteTable(baseId, lookupMainTable.id);
      await permanentDeleteTable(baseId, lookupSourceTable.id);
    });

    // Helper functions
    async function getFilteredRecords(tableId: string, filter: IFilter) {
      return (await apiGetRecords(tableId, { fieldKeyType: FieldKeyType.Id, filter })).data;
    }

    async function getAggregationValue(tableId: string, fieldId: string, func: StatisticsFunc) {
      const { data } = await getAggregation(tableId, { field: { [func]: [fieldId] } });
      return data.aggregations?.find((a) => a.fieldId === fieldId)?.total;
    }

    // Boolean formula field tests
    it.each([
      { value: true, expected: 2 },
      { value: null, expected: 4 },
    ])('formula field: filter is $value -> $expected records', async ({ value, expected }) => {
      const filter: IFilter = {
        filterSet: [{ fieldId: formulaFieldId, operator: is.value, value }],
        conjunction: and.value,
      };
      const { records } = await getFilteredRecords(formulaTable.id, filter);
      expect(records.length).toBe(expected);
    });

    it.each([
      { func: StatisticsFunc.Checked, expected: 2, isPercent: false },
      { func: StatisticsFunc.UnChecked, expected: 4, isPercent: false },
      { func: StatisticsFunc.PercentChecked, expected: 33.33, isPercent: true },
      { func: StatisticsFunc.PercentUnChecked, expected: 66.67, isPercent: true },
    ])('formula field: $func -> $expected', async ({ func, expected, isPercent }) => {
      const result = await getAggregationValue(formulaTable.id, formulaFieldId, func);
      expect(result?.aggFunc).toBe(func);
      isPercent
        ? expect(Number(result?.value)).toBeCloseTo(expected, 1)
        : expect(Number(result?.value)).toBe(expected);
    });

    // Checkbox field regression tests
    it.each([
      { value: true, expected: 2 },
      { value: null, expected: 2 },
    ])('checkbox field: filter is $value -> $expected records', async ({ value, expected }) => {
      const filter: IFilter = {
        filterSet: [{ fieldId: checkboxFieldId, operator: is.value, value }],
        conjunction: and.value,
      };
      const { records } = await getFilteredRecords(checkboxTable.id, filter);
      expect(records.length).toBe(expected);
    });

    it.each([
      { func: StatisticsFunc.PercentChecked, expected: 50 },
      { func: StatisticsFunc.PercentUnChecked, expected: 50 },
    ])('checkbox field: $func -> $expected%', async ({ func, expected }) => {
      const result = await getAggregationValue(checkboxTable.id, checkboxFieldId, func);
      expect(result?.aggFunc).toBe(func);
      expect(Number(result?.value)).toBeCloseTo(expected, 1);
    });

    // Lookup checkbox (multiple value) tests
    it.each([
      { func: StatisticsFunc.PercentChecked, expected: 50 },
      { func: StatisticsFunc.PercentUnChecked, expected: 50 },
    ])('lookup checkbox: $func -> $expected%', async ({ func, expected }) => {
      const result = await getAggregationValue(lookupMainTable.id, lookupFieldId, func);
      expect(result?.aggFunc).toBe(func);
      expect(Number(result?.value)).toBeCloseTo(expected, 1);
    });
  });

  // T1781: SQL LIKE wildcards (%, _, \) not escaped in contains filter and search
  describe('T1781: SQL LIKE wildcard escape', () => {
    let table: ITableFullVo;
    let fieldId: string;

    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'like_wildcard_test',
        fields: [{ name: 'Text', type: FieldType.SingleLineText }],
        records: [
          { fields: { Text: 'Contains % percent sign' } },
          { fields: { Text: 'Contains _ underscore' } },
          { fields: { Text: 'Contains \\ backslash' } },
          { fields: { Text: 'Normal text' } },
          { fields: { Text: '100%' } },
          { fields: { Text: '50%' } },
          { fields: { Text: 'file_name.txt' } },
          { fields: { Text: 'path\\to\\file' } },
          { fields: { Text: '%_%' } },
          { fields: { Text: null } },
        ],
      });
      fieldId = table.fields.find((f) => f.name === 'Text')!.id;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it.each([
      { op: contains.value, value: '%', expected: 4 },
      { op: contains.value, value: '_', expected: 3 },
      { op: contains.value, value: '\\', expected: 2 },
      { op: contains.value, value: '%_%', expected: 1 },
      { op: contains.value, value: '0%', expected: 2 },
      { op: doesNotContain.value, value: '%', expected: 6 },
      { op: doesNotContain.value, value: '_', expected: 7 },
    ])('filter $op "$value" -> $expected records', async ({ op, value, expected }) => {
      const filter: IFilter = {
        filterSet: [{ fieldId, operator: op, value }],
        conjunction: and.value,
      };
      const { data } = await apiGetRecords(table.id, { fieldKeyType: FieldKeyType.Id, filter });
      expect(data.records.length).toBe(expected);
    });

    it.each([
      { value: '%', expected: 4 },
      { value: '_', expected: 3 },
      { value: '\\', expected: 2 },
    ])('search "$value" -> $expected records', async ({ value, expected }) => {
      const { data } = await apiGetRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        search: [value, fieldId, true],
      });
      expect(data.records.length).toBe(expected);
    });

    it('global search "%" -> 4 records', async () => {
      const { data } = await apiGetRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        search: ['%', '', true],
      });
      expect(data.records.length).toBe(4);
    });

    describe.skipIf(globalThis.testConfig.driver === DriverClient.Sqlite)(
      'with search index',
      () => {
        let indexedTable: ITableFullVo;

        beforeAll(async () => {
          indexedTable = await createTable(baseId, {
            name: 'search_index_test',
            fields: [{ name: 'Text', type: FieldType.SingleLineText }],
            records: [
              { fields: { Text: '50% off' } },
              { fields: { Text: 'file_name.txt' } },
              { fields: { Text: 'normal' } },
            ],
          });
          await toggleTableIndex(baseId, indexedTable.id, { type: TableIndex.search });
        });

        afterAll(async () => {
          await permanentDeleteTable(baseId, indexedTable.id);
        });

        it.each([
          { value: '%', expected: 1 },
          { value: '_', expected: 1 },
        ])('global search "$value" with index -> $expected record', async ({ value, expected }) => {
          const { data } = await apiGetRecords(indexedTable.id, {
            fieldKeyType: FieldKeyType.Id,
            search: [value, '', true],
          });
          expect(data.records.length).toBe(expected);
        });
      }
    );
  });
});
