import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, SortFunc, StatisticsFunc, ViewType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  getAggregation,
  getSearchCount,
  getSearchIndex,
  createField,
  updateViewColumnMeta,
  getRecordIndex,
  updateViewSort,
} from '@teable/openapi';
import { x_20 } from './data-helpers/20x';
import { x_20_link, x_20_link_from_lookups } from './data-helpers/20x-link';
import { getError } from './utils/get-error';

import {
  createTable,
  permanentDeleteTable,
  initApp,
  createRecords,
  getRecords,
  createView,
} from './utils/init-app';

describe('OpenAPI AggregationController (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  let subTable: ITableFullVo;
  const baseId = globalThis.testConfig.baseId;

  afterAll(async () => {
    await app.close();
  });

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
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

    await createField(table.id, {
      name: 'Formula_Boolean',
      options: {
        expression: `{${table.fields[0].id}} > 1`,
      },
      type: FieldType.Formula,
    });
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
    await permanentDeleteTable(baseId, subTable.id);
  });

  describe.skip('OpenAPI AggregationController (e2e) get count with search query', () => {
    it('should get searchCount', async () => {
      const result = await getSearchCount(table.id, {
        // eslint-disable-next-line sonarjs/no-duplicate-string
        search: ['Text Field', '', false],
      });
      expect(result?.data?.count).toBe(22);
    });

    it('should filter the hidden filed', async () => {
      const result = await getSearchCount(table.id, {
        search: ['1', '', false],
      });
      await updateViewColumnMeta(table.id, table.views[0].id, [
        {
          fieldId: table.fields[1].id,
          columnMeta: { hidden: true },
        },
      ]);
      const result2 = await getSearchCount(table.id, {
        search: ['1', '', false],
        viewId: table.views[0].id,
      });
      expect(result?.data?.count).toBe(86);
      expect(result2?.data?.count).toBe(74);
    });

    it('should return 0 when there is no result', async () => {
      const result = await getSearchCount(table.id, {
        search: ['Go to Gentle night', '', false],
      });
      expect(result?.data?.count).toBe(0);
    });
  });

  describe('OpenAPI AggregationController (e2e) get record index with query', () => {
    it('should get search index', async () => {
      const result = await getSearchIndex(table.id, {
        take: 10,
        search: ['Text Field', '', false],
      });
      const targetFieldId = table.fields?.[0]?.id;
      expect(result?.data?.length).toBe(10);
      expect(result?.data?.map(({ index, fieldId }) => ({ index, fieldId }))).toEqual([
        { index: 2, fieldId: targetFieldId },
        { index: 3, fieldId: targetFieldId },
        { index: 4, fieldId: targetFieldId },
        { index: 5, fieldId: targetFieldId },
        { index: 6, fieldId: targetFieldId },
        { index: 7, fieldId: targetFieldId },
        { index: 8, fieldId: targetFieldId },
        { index: 9, fieldId: targetFieldId },
        { index: 10, fieldId: targetFieldId },
        { index: 11, fieldId: targetFieldId },
      ]);
    });

    it('should get search index with offset', async () => {
      const result = await getSearchIndex(table.id, {
        take: 10,
        skip: 1,
        search: ['Text Field', '', false],
      });
      const targetFieldId = table.fields?.[0]?.id;
      expect(result?.data?.length).toBe(10);
      expect(result?.data?.map(({ index, fieldId }) => ({ index, fieldId }))).toEqual([
        { index: 3, fieldId: targetFieldId },
        { index: 4, fieldId: targetFieldId },
        { index: 5, fieldId: targetFieldId },
        { index: 6, fieldId: targetFieldId },
        { index: 7, fieldId: targetFieldId },
        { index: 8, fieldId: targetFieldId },
        { index: 9, fieldId: targetFieldId },
        { index: 10, fieldId: targetFieldId },
        { index: 11, fieldId: targetFieldId },
        { index: 12, fieldId: targetFieldId },
      ]);
    });

    it('should throw a error when take over 1000', async () => {
      const error = await getError(() =>
        getSearchIndex(table.id, {
          take: 1001,
          search: ['Text Field', '', false],
        })
      );
      expect(error?.status).toBe(400);
      expect(error?.message).toBe('The maximum search index result is 1000');
    });

    it('should return null when there is no found', async () => {
      const result2 = await getSearchIndex(table.id, {
        take: 1,
        search: ['Go to Gentle night', '', false],
      });
      expect(result2?.data).toBe('');
    });
  });

  describe('aggregation statistics with search filtering', () => {
    let statTable: ITableFullVo;
    let nameFieldId: string;
    let quantityFieldId: string;

    beforeAll(async () => {
      statTable = await createTable(baseId, {
        name: 'agg_search_filter',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Quantity', type: FieldType.Number },
        ],
        records: [
          { fields: { Name: 'apple phone', Quantity: 180 } },
          { fields: { Name: 'battery', Quantity: 60 } },
          { fields: { Name: 'apple cable', Quantity: 120 } },
        ],
      });

      nameFieldId = statTable.fields.find((field) => field.name === 'Name')!.id;
      quantityFieldId = statTable.fields.find((field) => field.name === 'Quantity')!.id;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, statTable.id);
    });

    const getAggValue = async (
      statisticFunc: StatisticsFunc,
      search?: [string, string, boolean]
    ) => {
      const result = (
        await getAggregation(statTable.id, {
          field: { [statisticFunc]: [quantityFieldId] },
          ...(search ? { search } : {}),
        })
      ).data;

      return result.aggregations?.find((agg) => agg.fieldId === quantityFieldId)?.total?.value;
    };

    it.each<[StatisticsFunc, number, number]>([
      [StatisticsFunc.Sum, 360, 300],
      [StatisticsFunc.Average, 120, 150],
      [StatisticsFunc.Min, 60, 120],
      [StatisticsFunc.Max, 180, 180],
      [StatisticsFunc.Count, 3, 2],
    ])('%s respects hide-not-matching search', async (statisticFunc, totalAll, totalFiltered) => {
      const initialValue = await getAggValue(statisticFunc);
      expect(initialValue).toBe(totalAll);

      const filteredValue = await getAggValue(statisticFunc, ['apple', nameFieldId, true]);
      expect(filteredValue).toBe(totalFiltered);
    });
  });

  describe('get record index', () => {
    let indexTable: ITableFullVo;
    let viewId: string;
    let numberFieldId: string;

    beforeAll(async () => {
      indexTable = await createTable(baseId, {
        name: 'agg_record_index',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Number', type: FieldType.Number },
        ],
        records: [
          { fields: { Name: 'Alice', Number: 30 } },
          { fields: { Name: 'Bob', Number: 10 } },
          { fields: { Name: 'Charlie', Number: 20 } },
        ],
      });

      numberFieldId = indexTable.fields.find((f) => f.name === 'Number')!.id;

      const view = await createView(indexTable.id, {
        name: 'Sorted by Number',
        type: ViewType.Grid,
      });
      viewId = view.id;

      await updateViewSort(indexTable.id, viewId, {
        sort: { sortObjs: [{ fieldId: numberFieldId, order: SortFunc.Asc }] },
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, indexTable.id);
    });

    it('should return correct index with view sort', async () => {
      const { records } = await getRecords(indexTable.id, { fieldKeyType: FieldKeyType.Id });
      const nameFieldId = indexTable.fields.find((f) => f.name === 'Name')!.id;

      const alice = records.find((r) => r.fields[nameFieldId] === 'Alice')!;
      const bob = records.find((r) => r.fields[nameFieldId] === 'Bob')!;

      // Sorted by Number ASC: Bob(10)=0, Charlie(20)=1, Alice(30)=2
      const bobResult = await getRecordIndex(indexTable.id, { recordId: bob.id, viewId });
      const aliceResult = await getRecordIndex(indexTable.id, { recordId: alice.id, viewId });
      expect(bobResult.data).toEqual({ index: 0 });
      expect(aliceResult.data).toEqual({ index: 2 });
    });

    it('should return correct index for newly created record in sorted view', async () => {
      // Number=15 should land between Bob(10) and Charlie(20)
      const { records: newRecords } = await createRecords(indexTable.id, {
        records: [{ fields: { [numberFieldId]: 15 } }],
        fieldKeyType: FieldKeyType.Id,
      });

      const result = await getRecordIndex(indexTable.id, {
        recordId: newRecords[0].id,
        viewId,
      });
      // Bob(10)=0, NewRec(15)=1, Charlie(20)=2, Alice(30)=3
      expect(result.data).toEqual({ index: 1 });
    });

    it('should return falsy for non-existent record', async () => {
      const result = await getRecordIndex(indexTable.id, { recordId: 'recNonExistent' });
      expect(result.data).toBeFalsy();
    });
  });
});
