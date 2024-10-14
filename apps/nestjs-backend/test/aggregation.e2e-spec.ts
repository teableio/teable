import type { INestApplication } from '@nestjs/common';
import { SortFunc } from '@teable/core';
import type { IGroup, StatisticsFunc } from '@teable/core';
import type { IGroupHeaderPoint, ITableFullVo } from '@teable/openapi';
import { getAggregation, getGroupPoints, getRowCount, GroupPointType } from '@teable/openapi';
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
import { createTable, permanentDeleteTable, initApp, createRecords } from './utils/init-app';

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
    fieldId: string[],
    groupBy?: IGroup
  ) {
    return (
      await getAggregation(tableId, {
        viewId: viewId,
        field: { [funcs]: fieldId },
        groupBy,
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

      test.each(TEXT_FIELD_CASES)(
        `should agg func [$aggFunc] value with groupBy: $expectGroupedCount`,
        async ({ fieldIndex, aggFunc, expectGroupedCount }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;

          const result = await getViewAggregations(
            tableId,
            viewId,
            aggFunc,
            [fieldId],
            [
              {
                fieldId,
                order: SortFunc.Asc,
              },
            ]
          );
          expect(result).toBeDefined();
          expect(result.aggregations?.length).toBeGreaterThan(0);

          const [{ group }] = result.aggregations!;
          expect(group).toBeDefined();
          expect(Object.keys(group ?? []).length).toBe(expectGroupedCount);
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

      test.each(NUMBER_FIELD_CASES)(
        `should agg func [$aggFunc] value: $expectGroupedCount`,
        async ({ fieldIndex, aggFunc, expectGroupedCount }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;

          const result = await getViewAggregations(
            tableId,
            viewId,
            aggFunc,
            [fieldId],
            [
              {
                fieldId,
                order: SortFunc.Asc,
              },
            ]
          );

          const [{ group }] = result.aggregations!;
          expect(group).toBeDefined();
          expect(Object.keys(group ?? []).length).toBe(expectGroupedCount);
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

      test.each(SINGLE_SELECT_FIELD_CASES)(
        `should agg func [$aggFunc] value with groupBy: $expectGroupedCount`,
        async ({ fieldIndex, aggFunc, expectGroupedCount }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;

          const result = await getViewAggregations(
            tableId,
            viewId,
            aggFunc,
            [fieldId],
            [
              {
                fieldId,
                order: SortFunc.Asc,
              },
            ]
          );
          expect(result).toBeDefined();
          expect(result.aggregations?.length).toBeGreaterThan(0);

          const [{ group }] = result.aggregations!;
          expect(group).toBeDefined();
          expect(Object.keys(group ?? []).length).toEqual(expectGroupedCount);
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

      test.each(MULTIPLE_SELECT_FIELD_CASES)(
        `should agg func [$aggFunc] value with groupBy: $expectGroupedCount`,
        async ({ fieldIndex, aggFunc, expectGroupedCount }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;

          const result = await getViewAggregations(
            tableId,
            viewId,
            aggFunc,
            [fieldId],
            [
              {
                fieldId,
                order: SortFunc.Asc,
              },
            ]
          );
          expect(result).toBeDefined();
          expect(result.aggregations?.length).toBeGreaterThan(0);

          const [{ group }] = result.aggregations!;
          expect(group).toBeDefined();
          expect(Object.keys(group ?? []).length).toEqual(expectGroupedCount);
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

      test.each(DATE_FIELD_CASES)(
        `should agg func [$aggFunc] value with groupBy: $expectGroupedCount`,
        async ({ fieldIndex, aggFunc, expectGroupedCount }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;

          const result = await getViewAggregations(
            tableId,
            viewId,
            aggFunc,
            [fieldId],
            [
              {
                fieldId,
                order: SortFunc.Asc,
              },
            ]
          );
          expect(result).toBeDefined();
          expect(result.aggregations?.length).toBeGreaterThan(0);

          const [{ group }] = result.aggregations!;
          expect(group).toBeDefined();
          expect(Object.keys(group ?? []).length).toEqual(expectGroupedCount);
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

      test.each(CHECKBOX_FIELD_CASES)(
        `should agg func [$aggFunc] value with groupBy: $expectGroupedCount`,
        async ({ fieldIndex, aggFunc, expectGroupedCount }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;

          const result = await getViewAggregations(
            tableId,
            viewId,
            aggFunc,
            [fieldId],
            [
              {
                fieldId,
                order: SortFunc.Asc,
              },
            ]
          );
          expect(result).toBeDefined();
          expect(result.aggregations?.length).toBeGreaterThan(0);

          const [{ group }] = result.aggregations!;
          expect(group).toBeDefined();
          expect(Object.keys(group ?? []).length).toEqual(expectGroupedCount);
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

      test.each(USER_FIELD_CASES)(
        `should agg func [$aggFunc] value with groupBy: $expectGroupedCount`,
        async ({ fieldIndex, aggFunc, expectGroupedCount }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;

          const result = await getViewAggregations(
            tableId,
            viewId,
            aggFunc,
            [fieldId],
            [
              {
                fieldId,
                order: SortFunc.Asc,
              },
            ]
          );
          expect(result).toBeDefined();
          expect(result.aggregations?.length).toBeGreaterThan(0);

          const [{ group }] = result.aggregations!;
          expect(group).toBeDefined();
          expect(Object.keys(group ?? []).length).toEqual(expectGroupedCount);
        }
      );
    });
  });

  describe('get group point by group', () => {
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

    it('should get group points with collapsed group IDs', async () => {
      const singleSelectField = table.fields[2];
      const groupBy = [
        {
          fieldId: singleSelectField.id,
          order: SortFunc.Asc,
        },
      ];
      const groupPoints = (await getGroupPoints(table.id, { groupBy })).data!;
      expect(groupPoints.length).toEqual(8);

      const firstGroupHeader = groupPoints.find(
        ({ type }) => type === GroupPointType.Header
      ) as IGroupHeaderPoint;

      const collapsedGroupPoints = (
        await getGroupPoints(table.id, { groupBy, collapsedGroupIds: [firstGroupHeader.id] })
      ).data!;

      expect(collapsedGroupPoints.length).toEqual(7);
    });

    it('should get group points by user field', async () => {
      const userField = table.fields[5];
      const multipleUserField = table.fields[7];

      await createRecords(table.id, {
        records: [
          {
            fields: {
              [userField.id]: {
                id: 'usrTestUserId',
                title: 'test',
                avatarUrl: 'https://test.com',
              },
              [multipleUserField.id]: [
                { id: 'usrTestUserId_1', title: 'test', email: 'test@test1.com' },
              ],
            },
          },
          {
            fields: {
              [userField.id]: {
                id: 'usrTestUserId',
                title: 'test',
                email: 'test@test.com',
                avatarUrl: 'https://test.com',
              },
              [multipleUserField.id]: [
                {
                  id: 'usrTestUserId_1',
                  title: 'test',
                  email: 'test@test.com',
                  avatarUrl: 'https://test1.com',
                },
              ],
            },
          },
        ],
      });

      const groupByUserField = [
        {
          fieldId: userField.id,
          order: SortFunc.Asc,
        },
      ];

      const groupByMultipleUserField = [
        {
          fieldId: multipleUserField.id,
          order: SortFunc.Asc,
        },
      ];
      const groupPoints = (await getGroupPoints(table.id, { groupBy: groupByUserField })).data!;
      expect(groupPoints.length).toEqual(4);

      const groupPointsForMultiple = (
        await getGroupPoints(table.id, { groupBy: groupByMultipleUserField })
      ).data!;
      expect(groupPointsForMultiple.length).toEqual(6);
    });
  });
});
