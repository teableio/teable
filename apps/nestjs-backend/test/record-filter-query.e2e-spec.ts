/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
import type { INestApplication } from '@nestjs/common';
import type { IFilter, ITableFullVo } from '@teable-group/core';
import { and, FieldKeyType } from '@teable-group/core';
import { getRecords as apiGetRecords } from '@teable-group/openapi';
import { x_20 } from './data-helpers/20x';
import {
  CHECKBOX_FIELD_CASES,
  DATE_FIELD_CASES,
  MULTIPLE_SELECT_FIELD_CASES,
  NUMBER_FIELD_CASES,
  SINGLE_SELECT_FIELD_CASES,
  TEXT_FIELD_CASES,
  USER_FIELD_CASES,
} from './data-helpers/caces';
import { createTable, deleteTable, initApp } from './utils/init-app';

describe('OpenAPI Record-Filter-Query (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  async function getFilterRecord(tableId: string, viewId: string, filter: IFilter) {
    return (
      await apiGetRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        filter: filter,
      })
    ).data;
  }

  describe('basis field filter record', () => {
    let table: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });
    });

    afterAll(async () => {
      await deleteTable(baseId, table.id);
    });

    describe('simple filter text field record', () => {
      test.each(TEXT_FIELD_CASES)(
        `should filter [$operator], query value: $queryValue, expect result length: $expectResultLength`,
        async ({
          fieldIndex,
          operator,
          queryValue,
          expectResultLength,
          expectMoreResults = false,
        }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;
          const conjunction = and.value;

          const filter: IFilter = {
            filterSet: [
              {
                fieldId: fieldId,
                value: queryValue,
                operator: operator,
              },
            ],
            conjunction,
          };

          const { records } = await getFilterRecord(tableId, viewId, filter);
          expect(records.length).toBe(expectResultLength);

          if (!expectMoreResults) {
            expect(records).not.toMatchObject([
              expect.objectContaining({
                fields: {
                  [fieldId]: queryValue,
                },
              }),
            ]);
          }
        }
      );
    });

    describe('simple filter number field record', () => {
      test.each(NUMBER_FIELD_CASES)(
        `should filter [$operator], query value: $queryValue, expect result length: $expectResultLength`,
        async ({
          fieldIndex,
          operator,
          queryValue,
          expectResultLength,
          expectMoreResults = false,
        }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;
          const conjunction = and.value;

          const filter: IFilter = {
            filterSet: [
              {
                fieldId: fieldId,
                value: queryValue,
                operator: operator,
              },
            ],
            conjunction,
          };

          const { records } = await getFilterRecord(tableId, viewId, filter);
          expect(records.length).toBe(expectResultLength);

          if (!expectMoreResults) {
            expect(records).not.toMatchObject([
              expect.objectContaining({
                fields: {
                  [fieldId]: queryValue,
                },
              }),
            ]);
          }
        }
      );
    });

    describe('simple filter single select field record', () => {
      test.each(SINGLE_SELECT_FIELD_CASES)(
        `should filter [$operator], query value: $queryValue, expect result length: $expectResultLength`,
        async ({
          fieldIndex,
          operator,
          queryValue,
          expectResultLength,
          expectMoreResults = false,
        }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;
          const conjunction = and.value;

          const filter: IFilter = {
            filterSet: [
              {
                fieldId: fieldId,
                value: queryValue as any,
                operator: operator,
              },
            ],
            conjunction,
          };

          const { records } = await getFilterRecord(tableId, viewId, filter);
          expect(records.length).toBe(expectResultLength);

          if (!expectMoreResults) {
            expect(records).not.toMatchObject([
              expect.objectContaining({
                fields: {
                  [fieldId]: queryValue,
                },
              }),
            ]);
          }
        }
      );
    });

    describe('simple filter date field record', () => {
      test.each(DATE_FIELD_CASES)(
        `should filter [$operator], query mode: $queryValue.mode, expect result length: $expectResultLength`,
        async ({ fieldIndex, operator, queryValue, expectResultLength }) => {
          // if (!(operator === 'isWithIn' && queryValue?.mode === 'nextWeek')) {
          //   return;
          // }

          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;
          const conjunction = and.value;

          const filter: IFilter = {
            filterSet: [
              {
                fieldId: fieldId,
                value: queryValue as any,
                operator: operator,
              },
            ],
            conjunction,
          };

          const { records } = await getFilterRecord(tableId, viewId, filter);
          expect(records.length).toBe(expectResultLength);
        }
      );
    });

    describe('simple filter checkbox field record', () => {
      test.each(CHECKBOX_FIELD_CASES)(
        `should filter [$operator], query value: $queryValue, expect result length: $expectResultLength`,
        async ({
          fieldIndex,
          operator,
          queryValue,
          expectResultLength,
          expectMoreResults = false,
        }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;
          const conjunction = and.value;

          const filter: IFilter = {
            filterSet: [
              {
                fieldId: fieldId,
                value: queryValue as any,
                operator: operator,
              },
            ],
            conjunction,
          };

          const { records } = await getFilterRecord(tableId, viewId, filter);
          expect(records.length).toBe(expectResultLength);

          if (!expectMoreResults) {
            expect(records).not.toMatchObject([
              expect.objectContaining({
                fields: {
                  [fieldId]: queryValue,
                },
              }),
            ]);
          }
        }
      );
    });

    describe('simple filter user field record', () => {
      test.each(USER_FIELD_CASES)(
        `should filter [$operator], query value: $queryValue, expect result length: $expectResultLength`,
        async ({
          fieldIndex,
          operator,
          queryValue,
          expectResultLength,
          expectMoreResults = false,
        }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;
          const conjunction = and.value;

          const filter: IFilter = {
            filterSet: [
              {
                fieldId: fieldId,
                value: queryValue as any,
                operator: operator,
              },
            ],
            conjunction,
          };

          const { records } = await getFilterRecord(tableId, viewId, filter);
          expect(records.length).toBe(expectResultLength);

          if (!expectMoreResults) {
            expect(records).not.toMatchObject([
              expect.objectContaining({
                fields: {
                  [fieldId]: queryValue,
                },
              }),
            ]);
          }
        }
      );
    });

    describe('simple filter multiple select field record', () => {
      test.each(MULTIPLE_SELECT_FIELD_CASES)(
        `should filter [$operator], query value: $queryValue, expect result length: $expectResultLength`,
        async ({
          fieldIndex,
          operator,
          queryValue,
          expectResultLength,
          expectMoreResults = false,
        }) => {
          const tableId = table.id;
          const viewId = table.views[0].id;
          const fieldId = table.fields[fieldIndex].id;
          const conjunction = and.value;

          const filter: IFilter = {
            filterSet: [
              {
                fieldId: fieldId,
                value: queryValue as any,
                operator: operator,
              },
            ],
            conjunction,
          };

          const { records } = await getFilterRecord(tableId, viewId, filter);
          expect(records.length).toBe(expectResultLength);

          if (!expectMoreResults) {
            expect(records).not.toMatchObject([
              expect.objectContaining({
                fields: {
                  [fieldId]: queryValue,
                },
              }),
            ]);
          }
        }
      );
    });
  });
});
