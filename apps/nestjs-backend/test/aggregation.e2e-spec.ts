import type { INestApplication } from '@nestjs/common';
import type { ITableFullVo } from '@teable-group/core';
import { StatisticsFunc } from '@teable-group/core';
import { getAggregation, getRowCount } from '@teable-group/openapi';
import { x_20 } from './data-helpers/20x';
import { createTable, deleteTable, initApp } from './utils/init-app';

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
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'agg_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });
    });

    afterAll(async () => {
      await deleteTable(baseId, table.id);
    });

    it('should get rowCount', async () => {
      const { rowCount } = await getViewRowCount(table.id, table.views[0].id);
      expect(rowCount).toEqual(23);
    });

    const cases = [
      {
        fieldIndex: 0,
        aggFunc: StatisticsFunc.Empty,
        expectValue: 1,
      },
      {
        fieldIndex: 1,
        aggFunc: StatisticsFunc.Filled,
        expectValue: 22,
      },
      {
        fieldIndex: 1,
        aggFunc: StatisticsFunc.Unique,
        expectValue: 21,
      },
      {
        fieldIndex: 1,
        aggFunc: StatisticsFunc.Max,
        expectValue: 20,
      },
      {
        fieldIndex: 1,
        aggFunc: StatisticsFunc.Min,
        expectValue: 0,
      },
      {
        fieldIndex: 1,
        aggFunc: StatisticsFunc.Sum,
        expectValue: 220,
      },
      {
        fieldIndex: 1,
        aggFunc: StatisticsFunc.Average,
        expectValue: 10,
      },
      {
        fieldIndex: 4,
        aggFunc: StatisticsFunc.Checked,
        expectValue: 4,
      },
      {
        fieldIndex: 4,
        aggFunc: StatisticsFunc.UnChecked,
        expectValue: 19,
      },
      {
        fieldIndex: 2,
        aggFunc: StatisticsFunc.PercentEmpty,
        expectValue: 47.826086,
      },
      {
        fieldIndex: 0,
        aggFunc: StatisticsFunc.PercentFilled,
        expectValue: 95.652173,
      },
      {
        fieldIndex: 2,
        aggFunc: StatisticsFunc.PercentUnique,
        expectValue: 13.043478,
      },
      {
        fieldIndex: 4,
        aggFunc: StatisticsFunc.PercentChecked,
        expectValue: 17.391304,
      },
      {
        fieldIndex: 4,
        aggFunc: StatisticsFunc.PercentUnChecked,
        expectValue: 82.608695,
      },

      {
        fieldIndex: 3,
        aggFunc: StatisticsFunc.EarliestDate,
        expectValue: '2019-12-31T16:00:00.000Z',
      },
      {
        fieldIndex: 3,
        aggFunc: StatisticsFunc.LatestDate,
        expectValue: '2099-12-31T15:59:59.000Z',
      },
      {
        fieldIndex: 3,
        aggFunc: StatisticsFunc.DateRangeOfDays,
        expectValue: 29219,
      },
      {
        fieldIndex: 3,
        aggFunc: StatisticsFunc.DateRangeOfMonths,
        expectValue: 959,
      },
    ];

    test.each(cases)(
      `should agg func [$aggFunc] value: $expectValue`,
      async ({ fieldIndex, aggFunc, expectValue }) => {
        const tableId = table.id;
        const viewId = table.views[0].id;
        const fieldId = table.fields[fieldIndex].id;

        const result = await getViewAggregations(tableId, viewId, aggFunc, [fieldId]);
        expect(result).toBeDefined();
        expect(result.aggregations?.length).toBeGreaterThan(0);

        const [{ total }] = result.aggregations!;
        expect(total?.aggFunc).toBe(aggFunc);

        if (typeof expectValue === 'string') {
          expect(total?.value).toBe(expectValue);
        } else {
          expect(total?.value).toBeCloseTo(expectValue, 4);
        }
      }
    );
  });
});
