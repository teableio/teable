import type { INestApplication } from '@nestjs/common';
import type { StatisticsFunc } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { getAggregation, getRowCount } from '@teable/openapi';
import { x_20 } from './data-helpers/20x';
import {
  CHECKBOX_FIELD_CASES,
  DATE_FIELD_CASES,
  MULTIPLE_SELECT_FIELD_CASES,
  NUMBER_FIELD_CASES,
  SINGLE_SELECT_FIELD_CASES,
  TEXT_FIELD_CASES,
  USER_FIELD_CASES,
} from './data-helpers/caces/aggregation-query';
import { createTable, permanentDeleteTable, initApp } from './utils/init-app';

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

  describe('basis field aggregation record', () => {
    let table: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'agg_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should get rowCount', async () => {
      const { rowCount } = await getViewRowCount(table.id, table.views[0].id);
      expect(rowCount).toEqual(23);
    });

    describe('simple aggregation text field record', () => {
      test.each(TEXT_FIELD_CASES)(
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
          expect(total?.value).toBeCloseTo(expectValue, 4);
        }
      );
    });

    describe('simple aggregation number field record', () => {
      test.each(NUMBER_FIELD_CASES)(
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
          expect(total?.value).toBeCloseTo(expectValue, 4);
        }
      );
    });

    describe('simple aggregation single select field record', () => {
      test.each(SINGLE_SELECT_FIELD_CASES)(
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
          expect(total?.value).toBeCloseTo(expectValue, 4);
        }
      );
    });

    describe('simple aggregation multiple select field record', () => {
      test.each(MULTIPLE_SELECT_FIELD_CASES)(
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
          expect(total?.value).toBeCloseTo(expectValue, 4);
        }
      );
    });

    describe('simple aggregation date field record', () => {
      test.each(DATE_FIELD_CASES)(
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
          if (typeof expectValue === 'number') {
            expect(total?.value).toBeCloseTo(expectValue, 4);
          } else {
            expect(total?.value).toBe(expectValue);
          }
        }
      );
    });

    describe('simple aggregation checkbox field record', () => {
      test.each(CHECKBOX_FIELD_CASES)(
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
          expect(total?.value).toBeCloseTo(expectValue, 4);
        }
      );
    });

    describe('simple aggregation user field record', () => {
      test.each(USER_FIELD_CASES)(
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
          expect(total?.value).toBeCloseTo(expectValue, 4);
        }
      );
    });
  });
});
