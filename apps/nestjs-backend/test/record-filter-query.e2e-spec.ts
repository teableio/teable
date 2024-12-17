/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
import type { INestApplication } from '@nestjs/common';
import type { IFilter, IOperator } from '@teable/core';
import { and, FieldKeyType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { getRecords as apiGetRecords, createField, getFields } from '@teable/openapi';
import { x_20 } from './data-helpers/20x';
import { x_20_link, x_20_link_from_lookups } from './data-helpers/20x-link';
import {
  CHECKBOX_FIELD_CASES,
  CHECKBOX_LOOKUP_FIELD_CASES,
  DATE_FIELD_CASES,
  DATE_LOOKUP_FIELD_CASES,
  MULTIPLE_SELECT_FIELD_CASES,
  MULTIPLE_SELECT_LOOKUP_FIELD_CASES,
  MULTIPLE_USER_FIELD_CASES,
  MULTIPLE_USER_LOOKUP_FIELD_CASES,
  NUMBER_FIELD_CASES,
  NUMBER_LOOKUP_FIELD_CASES,
  SINGLE_SELECT_FIELD_CASES,
  SINGLE_SELECT_LOOKUP_FIELD_CASES,
  TEXT_FIELD_CASES,
  TEXT_LOOKUP_FIELD_CASES,
  USER_FIELD_CASES,
  USER_LOOKUP_FIELD_CASES,
} from './data-helpers/caces/record-filter-query';
import { createTable, permanentDeleteTable, initApp } from './utils/init-app';

const testDesc = `should filter [$operator], query value: $queryValue, expect result length: $expectResultLength`;

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

  const doTest = async (
    table: ITableFullVo,
    {
      fieldIndex,
      operator,
      queryValue,
      expectResultLength,
      expectMoreResults = false,
    }: {
      fieldIndex: number;
      operator: IOperator;
      queryValue: any;
      expectResultLength: number;
      expectMoreResults?: boolean;
    }
  ) => {
    const tableId = table.id;
    const viewId = table.views[0].id;
    const fieldId = table.fields[fieldIndex].id;
    const conjunction = and.value;

    const filter: IFilter = {
      filterSet: [
        {
          fieldId: fieldId,
          value: queryValue,
          operator,
        },
      ],
      conjunction,
    };

    const { records } = await getFilterRecord(tableId, viewId!, filter);
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
  };

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
      await permanentDeleteTable(baseId, table.id);
    });

    describe('simple filter text field record', () => {
      test.each(TEXT_FIELD_CASES)(testDesc, async (param) => doTest(table, param));
    });

    describe('simple filter number field record', () => {
      test.each(NUMBER_FIELD_CASES)(testDesc, async (param) => doTest(table, param));
    });

    describe('simple filter single select field record', () => {
      test.each(SINGLE_SELECT_FIELD_CASES)(testDesc, async (param) => doTest(table, param));
    });

    describe('simple filter date field record', () => {
      test.each(DATE_FIELD_CASES)(
        `should filter [$operator], query mode: $queryValue.mode, expect result length: $expectResultLength`,
        async (param) => doTest(table, param)
      );
    });

    describe('simple filter checkbox field record', () => {
      test.each(CHECKBOX_FIELD_CASES)(testDesc, async (param) => doTest(table, param));
    });

    describe('simple filter user field record', () => {
      test.each([...USER_FIELD_CASES, ...MULTIPLE_USER_FIELD_CASES])(testDesc, async (param) =>
        doTest(table, param)
      );
    });

    describe('simple filter multiple select field record', () => {
      test.each(MULTIPLE_SELECT_FIELD_CASES)(testDesc, async (param) => doTest(table, param));
    });
  });

  describe('lookup field filter record', () => {
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
        name: 'lookup_filter_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      });

      const x20LinkFromLookups = x_20_link_from_lookups(table, subTable.fields[2].id);
      for (const field of x20LinkFromLookups.fields) {
        await createField(subTable.id, field);
      }

      table.fields = (await getFields(table.id)).data;
      subTable.fields = (await getFields(subTable.id)).data;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, subTable.id);
    });

    describe('filter lookup text field record', () => {
      test.each(TEXT_LOOKUP_FIELD_CASES)(testDesc, async (param) => doTest(subTable, param));
    });
    describe('filter lookup number field record', () => {
      test.each(NUMBER_LOOKUP_FIELD_CASES)(testDesc, async (param) => doTest(subTable, param));
    });

    describe('filter lookup single select field record', () => {
      test.each(SINGLE_SELECT_LOOKUP_FIELD_CASES)(testDesc, async (param) =>
        doTest(subTable, param)
      );
    });

    describe('filter lookup date field record', () => {
      test.each(DATE_LOOKUP_FIELD_CASES)(
        `should filter [$operator], query mode: $queryValue.mode, expect result length: $expectResultLength`,
        async (param) => doTest(subTable, param)
      );
    });

    describe('filter lookup checkbox field record', () => {
      test.each(CHECKBOX_LOOKUP_FIELD_CASES)(
        `should filter [$operator], query mode: $queryValue.mode, expect result length: $expectResultLength`,
        async (param) => doTest(subTable, param)
      );
    });

    describe('filter lookup user field record', () => {
      test.each([...USER_LOOKUP_FIELD_CASES, ...MULTIPLE_USER_LOOKUP_FIELD_CASES])(
        testDesc,
        async (param) => doTest(subTable, param)
      );
    });

    describe('filter lookup multiple select field record', () => {
      test.each(MULTIPLE_SELECT_LOOKUP_FIELD_CASES)(testDesc, async (param) =>
        doTest(subTable, param)
      );
    });
  });
});
