import { faker } from '@faker-js/faker';
import type { INestApplication } from '@nestjs/common';
import type { ITableFullVo } from '@teable-group/core';
import { StatisticsFunc } from '@teable-group/core';
import { getAggregation, getRowCount } from '@teable-group/openapi';
import { createRecords, createTable, deleteTable, initApp } from './utils/init-app';

describe('OpenAPI AggregationController (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  async function getViewAggregations(
    tableId: string,
    viewId: string,
    funcs: StatisticsFunc,
    fieldId: string[]
  ) {
    return (
      await getAggregation(tableId, {
        viewId: viewId,
        field: { [funcs]: fieldId },
      })
    ).data;
  }

  async function getViewRowCount(tableId: string, viewId: string) {
    return (await getRowCount(tableId, { viewId })).data;
  }

  describe('simple aggregation', () => {
    let table: ITableFullVo;
    beforeEach(async () => {
      table = await createTable(baseId, { name: 'table1' });
    });

    afterEach(async () => {
      await deleteTable(baseId, table.id);
    });

    it('should get rowCount', async () => {
      await createRecords(table.id, {
        records: [
          {
            fields: {
              [table.fields[0].id]: faker.string.sample(),
              [table.fields[1].id]: faker.number.int(),
            },
          },
        ],
      });

      const { rowCount } = await getViewRowCount(table.id, table.views[0].id);
      expect(rowCount).toEqual(4);
    });

    it('should get empty number', async () => {
      const tableId = table.id;
      const viewId = table.views[0].id;
      const aggFunc = StatisticsFunc.Empty;
      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[0].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[0].id,
            total: {
              aggFunc,
              value: 3,
            },
          },
        ]),
      });

      await createRecords(table.id, {
        records: [
          {
            fields: {
              [table.fields[0].id]: faker.string.sample(),
            },
          },
        ],
      });

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[1].id,
            total: {
              aggFunc,
              value: 4,
            },
          },
        ]),
      });
    });

    it('should get filled number', async () => {
      const tableId = table.id;
      const viewId = table.views[0].id;
      const aggFunc = StatisticsFunc.Filled;
      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[0].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[0].id,
            total: {
              aggFunc,
              value: 0,
            },
          },
        ]),
      });

      await createRecords(table.id, {
        records: [
          {
            fields: {
              [table.fields[0].id]: faker.string.sample(),
            },
          },
        ],
      });

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[0].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[0].id,
            total: {
              aggFunc,
              value: 1,
            },
          },
        ]),
      });
    });

    it('should get unique number', async () => {
      const tableId = table.id;
      const viewId = table.views[0].id;
      const aggFunc = StatisticsFunc.Unique;
      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[0].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[0].id,
            total: {
              aggFunc,
              value: 0,
            },
          },
        ]),
      });

      const identicalStr = faker.string.sample();
      await createRecords(tableId, {
        records: [
          {
            fields: {
              [table.fields[0].id]: identicalStr,
            },
          },
          {
            fields: {
              [table.fields[0].id]: identicalStr,
            },
          },
        ],
      });

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[0].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[0].id,
            total: {
              aggFunc,
              value: 1,
            },
          },
        ]),
      });

      await createRecords(table.id, {
        records: [
          {
            fields: {
              [table.fields[0].id]: faker.string.sample(),
            },
          },
        ],
      });

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[0].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[0].id,
            total: {
              aggFunc,
              value: 2,
            },
          },
        ]),
      });
    });

    it('should get max number', async () => {
      const tableId = table.id;
      const viewId = table.views[0].id;
      const aggFunc = StatisticsFunc.Max;
      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[1].id,
            total: {
              aggFunc,
              value: null,
            },
          },
        ]),
      });

      await createRecords(tableId, {
        records: [
          {
            fields: {
              [table.fields[1].id]: 9,
            },
          },
          {
            fields: {
              [table.fields[1].id]: 11,
            },
          },
        ],
      });

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[1].id,
            total: {
              aggFunc,
              value: 11,
            },
          },
        ]),
      });
    });

    it('should get min number', async () => {
      const tableId = table.id;
      const viewId = table.views[0].id;
      const aggFunc = StatisticsFunc.Min;
      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[1].id,
            total: {
              aggFunc,
              value: null,
            },
          },
        ]),
      });

      await createRecords(tableId, {
        records: [
          {
            fields: {
              [table.fields[1].id]: 22,
            },
          },
          {
            fields: {
              [table.fields[1].id]: 0,
            },
          },
        ],
      });

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[1].id,
            total: {
              aggFunc,
              value: 0,
            },
          },
        ]),
      });
    });

    it('should get sum number', async () => {
      const tableId = table.id;
      const viewId = table.views[0].id;
      const aggFunc = StatisticsFunc.Sum;
      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[1].id,
            total: {
              aggFunc,
              value: null,
            },
          },
        ]),
      });

      await createRecords(tableId, {
        records: [
          {
            fields: {
              [table.fields[1].id]: 6,
            },
          },
          {
            fields: {
              [table.fields[1].id]: 60,
            },
          },
        ],
      });

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[1].id,
            total: {
              aggFunc,
              value: 66,
            },
          },
        ]),
      });
    });

    it('should get average number', async () => {
      const tableId = table.id;
      const viewId = table.views[0].id;
      const aggFunc = StatisticsFunc.Average;
      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[1].id,
            total: {
              aggFunc,
              value: null,
            },
          },
        ]),
      });

      await createRecords(tableId, {
        records: [
          {
            fields: {
              [table.fields[1].id]: 6.6,
            },
          },
          {
            fields: {
              [table.fields[1].id]: 9.9,
            },
          },
        ],
      });

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        aggregations: expect.objectContaining([
          {
            fieldId: table.fields[1].id,
            total: {
              aggFunc,
              value: 8.25,
            },
          },
        ]),
      });
    });
  });
});
