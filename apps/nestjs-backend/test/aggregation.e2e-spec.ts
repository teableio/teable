/* eslint-disable @typescript-eslint/naming-convention */
import fs from 'fs';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, IFilter, IGroup } from '@teable/core';
import {
  Colors,
  FieldKeyType,
  FieldType,
  Relationship,
  is,
  isGreaterEqual,
  SortFunc,
  StatisticsFunc,
  ViewType,
} from '@teable/core';
import type { IGroupHeaderPoint, ITableFullVo } from '@teable/openapi';
import {
  getAggregation,
  getCalendarDailyCollection,
  getGroupPoints,
  getRowCount,
  getSearchIndex,
  GroupPointType,
  uploadAttachment,
} from '@teable/openapi';
import StorageAdapter from '../src/features/attachments/plugins/adapter';
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
import {
  createTable,
  permanentDeleteTable,
  initApp,
  createRecords,
  createView,
  createField,
  updateRecordByApi,
  getRecords,
} from './utils/init-app';

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

    it('should limit rowCount to selectedRecordIds', async () => {
      const selectedIds = table.records.slice(0, 2).map((record) => record.id);
      const response = await getRowCount(table.id, {
        viewId: table.views[0].id,
        selectedRecordIds: selectedIds,
        ignoreViewQuery: true,
      });

      expect(response.data.rowCount).toEqual(selectedIds.length);
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

    it('percent aggregation zero', async () => {
      const tableId = table.id;
      const viewId = table.views[0].id;
      const fieldId = table.fields[0].id;
      const checkboxFieldId = table.fields[4].id;
      const result = await getAggregation(tableId, {
        viewId: viewId,
        field: {
          [StatisticsFunc.PercentFilled]: [fieldId],
          [StatisticsFunc.PercentUnique]: [fieldId],
          [StatisticsFunc.PercentChecked]: [checkboxFieldId],
          [StatisticsFunc.PercentUnChecked]: [checkboxFieldId],
          [StatisticsFunc.PercentEmpty]: [fieldId],
        },
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId,
              operator: is.value,
              value: 'xxxxxxxxxx',
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      }).then((res) => res.data);
      expect(result).toBeDefined();
      expect(result.aggregations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fieldId,
            total: expect.objectContaining({
              aggFunc: StatisticsFunc.PercentUnique,
            }),
          }),
          expect.objectContaining({
            fieldId,
            total: expect.objectContaining({
              aggFunc: StatisticsFunc.PercentEmpty,
            }),
          }),
          expect.objectContaining({
            fieldId,
            total: expect.objectContaining({
              aggFunc: StatisticsFunc.PercentFilled,
            }),
          }),
          expect.objectContaining({
            fieldId: checkboxFieldId,
            total: expect.objectContaining({
              aggFunc: StatisticsFunc.PercentChecked,
            }),
          }),
          expect.objectContaining({
            fieldId: checkboxFieldId,
            total: expect.objectContaining({
              aggFunc: StatisticsFunc.PercentUnChecked,
            }),
          }),
        ])
      );

      result.aggregations?.forEach((agg) => {
        expect(agg.total?.value).toBeCloseTo(0, 4);
      });
    });
  });

  describe('aggregation projection respects field selection', () => {
    let projectionTable: ITableFullVo;
    let foreignTable: ITableFullVo;
    let amountField: IFieldVo;
    let linkField: IFieldVo;
    let lookupField: IFieldVo;
    let viewId: string;

    const sumFieldDef = { name: 'Amount', type: FieldType.Number };
    const labelFieldDef = { name: 'Label', type: FieldType.SingleLineText };
    const foreignNameFieldDef = { name: 'Order Name', type: FieldType.SingleLineText };
    const foreignTagFieldDef = { name: 'Order Tag', type: FieldType.SingleLineText };

    beforeAll(async () => {
      projectionTable = await createTable(baseId, {
        name: 'agg_projection_main',
        fields: [labelFieldDef, sumFieldDef],
        records: [
          { fields: { [labelFieldDef.name]: 'Row 1', [sumFieldDef.name]: 10 } },
          { fields: { [labelFieldDef.name]: 'Row 2', [sumFieldDef.name]: 30 } },
        ],
      });

      amountField = projectionTable.fields.find((field) => field.name === sumFieldDef.name)!;
      viewId = projectionTable.views[0].id;

      foreignTable = await createTable(baseId, {
        name: 'agg_projection_foreign',
        fields: [foreignNameFieldDef, foreignTagFieldDef],
        records: [
          {
            fields: {
              [foreignNameFieldDef.name]: 'Order A',
              [foreignTagFieldDef.name]: 'include',
            },
          },
          {
            fields: {
              [foreignNameFieldDef.name]: 'Order B',
              [foreignTagFieldDef.name]: 'exclude',
            },
          },
        ],
      });

      const foreignTagField = foreignTable.fields.find(
        (field) => field.name === foreignTagFieldDef.name
      )!;

      linkField = (await createField(projectionTable.id, {
        name: 'Orders',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
        },
      })) as IFieldVo;

      lookupField = (await createField(projectionTable.id, {
        name: 'Order Tag Lookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: foreignTable.id,
          linkFieldId: linkField.id,
          lookupFieldId: foreignTagField.id,
        },
      })) as IFieldVo;

      const [firstRecord, secondRecord] = projectionTable.records;
      await updateRecordByApi(projectionTable.id, firstRecord.id, linkField.id, [
        { id: foreignTable.records[0].id },
      ]);
      await updateRecordByApi(projectionTable.id, secondRecord.id, linkField.id, [
        { id: foreignTable.records[1].id },
      ]);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, projectionTable.id);
      await permanentDeleteTable(baseId, foreignTable.id);
    });

    it('should aggregate a number field with projection applied', async () => {
      const response = await getAggregation(projectionTable.id, {
        viewId,
        field: {
          [StatisticsFunc.Sum]: [amountField.id],
        },
      });
      const aggregation = response.data.aggregations?.find(
        (item) => item.fieldId === amountField.id
      );
      expect(aggregation?.total?.value).toBe(40);
    });

    it('should aggregate correctly when lookup fields are present', async () => {
      const response = await getAggregation(projectionTable.id, {
        viewId,
        field: {
          [StatisticsFunc.Sum]: [amountField.id],
        },
      });
      const aggregation = response.data.aggregations?.find(
        (item) => item.fieldId === amountField.id
      );
      expect(aggregation?.total?.value).toBe(40);
    });

    it('should sum correctly when filtering by lookup values', async () => {
      const response = await getAggregation(projectionTable.id, {
        viewId,
        field: {
          [StatisticsFunc.Sum]: [amountField.id],
        },
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: lookupField.id,
              operator: is.value,
              value: 'include',
            },
          ],
        } as IFilter,
      });
      const aggregation = response.data.aggregations?.find(
        (item) => item.fieldId === amountField.id
      );
      expect(aggregation?.total?.value).toBe(10);
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

    it('should get group header refs with collapsed group IDs', async () => {
      const singleSelectField = table.fields[2];
      const groupBy = [
        {
          fieldId: singleSelectField.id,
          order: SortFunc.Asc,
        },
      ];
      const originalResult = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        groupBy,
      });
      expect(originalResult.extra?.allGroupHeaderRefs?.length).toEqual(4);

      const firstGroupHeaderId = originalResult.extra!.allGroupHeaderRefs![0].id;

      const result = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        groupBy,
        collapsedGroupIds: [firstGroupHeaderId],
      });

      expect(result.extra?.allGroupHeaderRefs?.length).toEqual(4);
    });

    it('should keep single select group order', async () => {
      const singleSelectField = table.fields[2];
      const groupBy = [
        {
          fieldId: singleSelectField.id,
          order: SortFunc.Asc,
        },
      ];

      const groupPoints = (await getGroupPoints(table.id, { groupBy })).data!;
      const headerValues = groupPoints
        .filter((point): point is IGroupHeaderPoint => point.type === GroupPointType.Header)
        .filter(({ depth }) => depth === 0)
        .map(({ value }) => value);

      const expectedOptions = ['x', 'y', 'z'];
      const startIndex = headerValues[0] == null ? 1 : 0;
      expect(headerValues.slice(startIndex, startIndex + expectedOptions.length)).toEqual(
        expectedOptions
      );

      const tailValues = headerValues.slice(startIndex + expectedOptions.length);
      expect(tailValues.length <= 1).toBe(true);
      if (tailValues.length === 1) {
        expect(tailValues[0]).toBe('Unknown');
      }
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

  describe('should get calendar daily collection', () => {
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

    it('should get calendar daily collection', async () => {
      const result = await getCalendarDailyCollection(table.id, {
        startDateFieldId: table.fields[3].id,
        endDateFieldId: table.fields[3].id,
        startDate: '2022-01-27T16:00:00.000Z',
        endDate: '2022-03-12T16:00:00.000Z',
      });

      expect(result).toBeDefined();
      expect(result.data.countMap).toEqual({
        '2022-01-28': 1,
        '2022-03-01': 1,
        '2022-03-02': 1,
        '2022-03-12': 1,
      });
      expect(result.data.records.length).toEqual(4);
    });
  });

  describe('aggregation with ignoreViewQuery', () => {
    let table: ITableFullVo;
    let viewId: string;

    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'agg_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });

      const numberFieldId = table.fields[1].id;
      const view = await createView(table.id, {
        type: ViewType.Grid,
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: numberFieldId, operator: isGreaterEqual.value, value: 16 }],
        },
        sort: {
          sortObjs: [{ fieldId: numberFieldId, order: SortFunc.Asc }],
        },
        group: [{ fieldId: numberFieldId, order: SortFunc.Asc }],
      });
      viewId = view.id;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should get row count with ignoreViewQuery', async () => {
      const { rowCount } = (await getRowCount(table.id, { viewId, ignoreViewQuery: true })).data;
      expect(rowCount).toEqual(23);
    });

    it('should get aggregation with ignoreViewQuery', async () => {
      const result = (
        await getAggregation(table.id, {
          viewId,
          field: { [StatisticsFunc.Count]: [table.fields[0].id] },
          ignoreViewQuery: true,
        })
      ).data;
      expect(result.aggregations?.length).toEqual(1);
      expect(result.aggregations?.[0].total?.value).toEqual(23);
    });

    it('should get group points with ignoreViewQuery', async () => {
      const result = (
        await getGroupPoints(table.id, {
          viewId,
          groupBy: [{ fieldId: table.fields[0].id, order: SortFunc.Asc }],
          ignoreViewQuery: true,
        })
      ).data;
      const groupCount = result?.filter(({ type }) => type === GroupPointType.Header).length;
      expect(groupCount).toEqual(22);
    });

    // it.only('should get search count with ignoreViewQuery', async () => {
    //   const result = (
    //     await getSearchCount(table.id, {
    //       viewId,
    //       search: ['Text Field 10', '', false],
    //       ignoreViewQuery: true,
    //     })
    //   ).data;
    //   expect(result.count).toEqual(2);
    // });

    it('should get search index with ignoreViewQuery', async () => {
      const result = (
        await getSearchIndex(table.id, {
          viewId,
          take: 50,
          search: ['Text Field 10', '', false],
          ignoreViewQuery: true,
        })
      ).data;
      expect(result?.length).toEqual(2);
    });

    it('should get calendar daily collection with ignoreViewQuery', async () => {
      const result = await getCalendarDailyCollection(table.id, {
        viewId,
        startDateFieldId: table.fields[3].id,
        endDateFieldId: table.fields[3].id,
        startDate: '2022-01-27T16:00:00.000Z',
        endDate: '2022-03-12T16:00:00.000Z',
        ignoreViewQuery: true,
      });

      expect(result).toBeDefined();
      expect(result.data.countMap).toEqual({
        '2022-01-28': 1,
        '2022-03-01': 1,
        '2022-03-02': 1,
        '2022-03-12': 1,
      });
      expect(result.data.records.length).toEqual(4);
    });
  });

  describe('attachment total size aggregation with groupBy', () => {
    let tableId: string;
    let groupFieldId: string;
    let attachmentFieldId: string;
    let recordA1Id: string;
    let recordA2Id: string;
    let recordB1Id: string;
    let file10Path: string;
    let file20Path: string;

    beforeAll(async () => {
      file10Path = path.join(StorageAdapter.TEMPORARY_DIR, 'agg-10b.bin');
      file20Path = path.join(StorageAdapter.TEMPORARY_DIR, 'agg-20b.bin');
      fs.writeFileSync(file10Path, 'a'.repeat(10));
      fs.writeFileSync(file20Path, 'b'.repeat(20));

      const table = await createTable(baseId, {
        name: 'agg_attachment_group',
        fields: [
          {
            name: 'group',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { id: 'A', name: 'A', color: Colors.BlueBright },
                { id: 'B', name: 'B', color: Colors.CyanBright },
              ],
            },
          },
          {
            name: 'att',
            type: FieldType.Attachment,
          },
        ],
      });
      tableId = table.id;
      groupFieldId = table.fields[0].id;
      attachmentFieldId = table.fields[1].id;

      const created = await createRecords(tableId, {
        records: [
          { fields: { [groupFieldId]: 'A' } },
          { fields: { [groupFieldId]: 'A' } },
          { fields: { [groupFieldId]: 'B' } },
        ],
      });

      recordA1Id = created.records[0].id;
      recordA2Id = created.records[1].id;
      recordB1Id = created.records[2].id;

      await uploadAttachment(
        tableId,
        recordA1Id,
        attachmentFieldId,
        fs.createReadStream(file10Path)
      );
      await uploadAttachment(
        tableId,
        recordA2Id,
        attachmentFieldId,
        fs.createReadStream(file20Path)
      );
      await uploadAttachment(
        tableId,
        recordB1Id,
        attachmentFieldId,
        fs.createReadStream(file20Path)
      );
    });

    afterAll(async () => {
      try {
        await permanentDeleteTable(baseId, tableId);
      } finally {
        if (fs.existsSync(file10Path)) fs.unlinkSync(file10Path);
        if (fs.existsSync(file20Path)) fs.unlinkSync(file20Path);
      }
    });

    it('should compute per-group total attachment size correctly', async () => {
      const result = await getAggregation(tableId, {
        field: { [StatisticsFunc.TotalAttachmentSize]: [attachmentFieldId] },
        groupBy: [{ fieldId: groupFieldId, order: SortFunc.Asc }],
      }).then((res) => res.data);

      expect(result.aggregations?.length).toBe(1);
      const [{ total, group }] = result.aggregations!;
      expect(total?.aggFunc).toBe(StatisticsFunc.TotalAttachmentSize);
      expect(Number(total?.value)).toBe(50);
      expect(group).toBeDefined();
      const values = Object.values(group ?? {})
        .map((g) => g.value as number)
        .sort((a, b) => a - b);
      expect(values).toEqual(['0', '20', '30']);
    });
  });
});
