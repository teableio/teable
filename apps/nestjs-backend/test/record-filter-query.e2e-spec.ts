/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
import type { INestApplication } from '@nestjs/common';
import type { IFilter, IOperator } from '@teable/core';
import { and, FieldKeyType, FieldType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { getRecords as apiGetRecords, createField, getFields } from '@teable/openapi';
import { textField, x_20 } from './data-helpers/20x';
import { x_20_link, x_20_link_from_lookups } from './data-helpers/20x-link';
import {
  CHECKBOX_FIELD_CASES,
  CHECKBOX_LOOKUP_FIELD_CASES,
  DATE_FIELD_CASES,
  DATE_LOOKUP_FIELD_CASES,
  DATE_RANGE_ERROR_CASES,
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
  const isForceV2 = process.env.FORCE_V2_ALL === 'true';
  // NOTE: v1 and v2 agree here — the shared core `validateCellValue` for
  // single-line text transforms '' to null, so the x_20 empty-string record is
  // empty on both write paths and the lookup counts match (isEmpty=7,
  // isNotEmpty=14).
  const textLookupFieldCases = TEXT_LOOKUP_FIELD_CASES;

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

    describe('dateRange invalid filters are skipped instead of crashing the query', () => {
      // [V2-BUG] v2 compat 层 record-open-api-v2.service.ts 的 mapLegacyDateRangeCondition 对倒置区间抛 400，而 v2 引擎/新 mapper 均按 v1 parity 跳过（编译为 no-op TRUE） —— v2 修复后重新启用（T6703）
      it.skipIf(isForceV2)('skips when start > end (compiler-level validation)', async () => {
        const { fieldIndex, operator, queryValue } = DATE_RANGE_ERROR_CASES.invalidRange;
        const filter: IFilter = {
          filterSet: [
            {
              fieldId: table.fields[fieldIndex].id,
              value: queryValue,
              operator,
            },
          ],
          conjunction: and.value,
        };
        const result = await getFilterRecord(table.id, table.views[0].id, filter);
        expect(result.records.length).toBeGreaterThan(0);
      });

      // [V2-BUG] 同上：v2 compat 层对 dateRange+isNot 抛 400（'dateRange mode only supports is/isWithIn operators'），v2 引擎层 TableRecordConditionWhereVisitor 按 v1 parity 跳过 —— v2 修复后重新启用（T6703）
      it.skipIf(isForceV2)(
        'skips when dateRange is used with isNot operator (analyzer-level validation)',
        async () => {
          const { fieldIndex, operator, queryValue } = DATE_RANGE_ERROR_CASES.invalidOperator;
          const filter: IFilter = {
            filterSet: [
              {
                fieldId: table.fields[fieldIndex].id,
                value: queryValue,
                operator,
              },
            ],
            conjunction: and.value,
          };
          const result = await getFilterRecord(table.id, table.views[0].id, filter);
          expect(result.records.length).toBeGreaterThan(0);
        }
      );
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
      test.each(textLookupFieldCases)(testDesc, async (param) => doTest(subTable, param));
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

  describe('filter record with special characters', () => {
    // A title carrying both quote kinds: a link `contains` filter must treat it
    // as data (GHSA-p7h6-58r8-v27m), never as part of the SQL or jsonpath text.
    const QUOTED_TITLE = `O'Reilly "quoted" (v1.0)`;
    // x_20_link links records 10 and 12 to foreign record index 4.
    const QUOTED_TITLE_LINKED_ROWS = 2;
    // 20 linked rows plus one empty record.
    const SUB_TABLE_ROWS = 21;
    let table: ITableFullVo;
    let subTable: ITableFullVo;
    beforeAll(async () => {
      const newRecords = [...x_20.records];
      newRecords.splice(
        1,
        3,
        ...[
          { fields: { [textField.name]: 'notepad++' } },
          { fields: { [textField.name]: 'notepad++@' } },
          { fields: { [textField.name]: 'notepad++@' } },
        ]
      );
      newRecords.splice(4, 1, { fields: { [textField.name]: QUOTED_TITLE } });
      table = await createTable(baseId, {
        name: 'special_characters',
        fields: x_20.fields,
        records: newRecords,
      });
      const x20Link = x_20_link(table);
      subTable = await createTable(baseId, {
        name: 'lookup_filter_special_characters',
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

    it('should filter record with special characters', async () => {
      const linkField = subTable.fields.find((field) => field.type === FieldType.Link)!;
      const { records } = await getFilterRecord(subTable.id, subTable.views[0].id, {
        filterSet: [{ fieldId: linkField.id, value: 'notepad++', operator: 'contains' }],
        conjunction: and.value,
      });
      expect(records.length).toBe(8);
    });

    it('should treat quotes in link and lookup contains filters as data', async () => {
      const linkField = subTable.fields.find((field) => field.type === FieldType.Link)!;
      const textLookupField = subTable.fields.find(
        (field) => field.isLookup && field.type === FieldType.SingleLineText
      )!;

      const { records: linked } = await getFilterRecord(subTable.id, subTable.views[0].id, {
        filterSet: [{ fieldId: linkField.id, value: QUOTED_TITLE, operator: 'contains' }],
        conjunction: and.value,
      });
      expect(linked.length).toBe(QUOTED_TITLE_LINKED_ROWS);

      const { records: notLinked } = await getFilterRecord(subTable.id, subTable.views[0].id, {
        filterSet: [{ fieldId: linkField.id, value: `O'Reilly`, operator: 'doesNotContain' }],
        conjunction: and.value,
      });
      expect(notLinked.length).toBe(SUB_TABLE_ROWS - QUOTED_TITLE_LINKED_ROWS);

      const { records: lookedUp } = await getFilterRecord(subTable.id, subTable.views[0].id, {
        filterSet: [{ fieldId: textLookupField.id, value: `O'Reilly "q`, operator: 'contains' }],
        conjunction: and.value,
      });
      expect(lookedUp.length).toBe(QUOTED_TITLE_LINKED_ROWS);
    });

    it('should not let a link contains filter break out of the query', async () => {
      const linkField = subTable.fields.find((field) => field.type === FieldType.Link)!;
      const { records } = await getFilterRecord(subTable.id, subTable.views[0].id, {
        filterSet: [{ fieldId: linkField.id, value: `zzz") ' OR 1=1 --`, operator: 'contains' }],
        conjunction: and.value,
      });
      expect(records.length).toBe(0);
    });
  });
});
