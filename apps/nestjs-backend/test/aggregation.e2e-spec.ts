import { faker } from '@faker-js/faker';
import type { INestApplication } from '@nestjs/common';
import type { ITableFullVo } from '@teable-group/core';
import { StatisticsFunc } from '@teable-group/core';
import qs from 'qs';
import type request from 'supertest';
import { createRecords, initApp } from './utils/init-app';

describe('OpenAPI AggregationController (e2e)', () => {
  let app: INestApplication;
  let request: request.SuperAgentTest;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;
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
      await request
        .get(`/api/table/${tableId}/aggregation/${viewId}`)
        .query(
          qs.stringify({
            field: { [funcs]: fieldId },
          })
        )
        .expect(200)
    ).body;
  }

  async function getViewRowCount(tableId: string, viewId: string) {
    return (await request.get(`/api/table/${tableId}/aggregation/${viewId}/rowCount`).expect(200))
      .body;
  }

  describe('simple aggregation', () => {
    let table: ITableFullVo;
    beforeEach(async () => {
      const result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table1',
        })
        .expect(201);
      table = result.body;
    });

    afterEach(async () => {
      await request.delete(`/api/base/${baseId}/table/arbitrary/${table.id}`);
    });

    it('should get rowCount', async () => {
      await createRecords(request, table.id, [
        {
          fields: {
            [table.fields[0].id]: faker.string.sample(),
            [table.fields[1].id]: faker.number.int(),
          },
        },
      ]);

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
        viewId: table.views[0].id,
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

      await createRecords(request, table.id, [
        {
          fields: {
            [table.fields[0].id]: faker.string.sample(),
          },
        },
      ]);

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        viewId: table.views[0].id,
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
        viewId: table.views[0].id,
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

      await createRecords(request, table.id, [
        {
          fields: {
            [table.fields[0].id]: faker.string.sample(),
          },
        },
      ]);

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[0].id])
      ).toMatchObject({
        viewId: table.views[0].id,
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
        viewId,
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
      await createRecords(request, tableId, [
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
      ]);

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[0].id])
      ).toMatchObject({
        viewId,
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

      await createRecords(request, table.id, [
        {
          fields: {
            [table.fields[0].id]: faker.string.sample(),
          },
        },
      ]);

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[0].id])
      ).toMatchObject({
        viewId,
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
        viewId,
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

      await createRecords(request, tableId, [
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
      ]);

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        viewId,
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
        viewId,
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

      await createRecords(request, tableId, [
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
      ]);

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        viewId,
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
        viewId,
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

      await createRecords(request, tableId, [
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
      ]);

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        viewId,
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
        viewId,
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

      await createRecords(request, tableId, [
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
      ]);

      expect(
        await getViewAggregations(tableId, viewId, aggFunc, [table.fields[1].id])
      ).toMatchObject({
        viewId,
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
