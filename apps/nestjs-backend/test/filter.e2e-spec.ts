import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, isEmpty, type IFieldVo, type IFilterRo } from '@teable/core';
import { updateViewFilter as apiSetViewFilter, getRecords as apiGetRecords } from '@teable/openapi';
import { initApp, getView, createTable, permanentDeleteTable, createField } from './utils/init-app';

let app: INestApplication;
const baseId = globalThis.testConfig.baseId;

beforeAll(async () => {
  const appCtx = await initApp();
  app = appCtx.app;
});

afterAll(async () => {
  await app.close();
});

async function updateViewFilter(tableId: string, viewId: string, filterRo: IFilterRo) {
  try {
    const result = await apiSetViewFilter(tableId, viewId, filterRo);
    return result.data;
  } catch (e) {
    console.log(e);
  }
}

describe('OpenAPI ViewController (e2e) option (PUT)', () => {
  let tableId: string;
  let viewId: string;
  let fields: IFieldVo[];
  beforeAll(async () => {
    const result = await createTable(baseId, {
      name: 'Table',
    });
    tableId = result.id;
    viewId = result.defaultViewId!;
    fields = result.fields;
  });
  afterAll(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  test(`/table/{tableId}/view/{viewId}/filter (PUT) update filter`, async () => {
    const assertFilter: IFilterRo = {
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: fields[0].id,
            operator: 'is',
            value: '2',
          },
        ],
      },
    };
    await updateViewFilter(tableId, viewId, assertFilter);
    const updatedView = await getView(tableId, viewId);
    const viewFilter = updatedView.filter;
    expect(viewFilter).toEqual(assertFilter.filter);
  });

  it('should not allow to modify filter for button field', async () => {
    const buttonField = await createField(tableId, {
      type: FieldType.Button,
    });
    const assertFilter: IFilterRo = {
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: buttonField.id,
            operator: isEmpty.value,
            value: null,
          },
        ],
      },
    };
    await expect(apiSetViewFilter(tableId, viewId, assertFilter)).rejects.toThrow();
  });
});

// V1 does not normalize is/isNot+null through the domain FieldConditionSpecBuilder,
// so this test only applies to V2.
describe.skipIf(process.env.FORCE_V2_ALL !== 'true')(
  'View filter with is/isNot null value (e2e)',
  () => {
    let tableId: string;
    let viewId: string;

    afterAll(async () => {
      await permanentDeleteTable(baseId, tableId);
    });

    it('should apply view filter with is+null (checkbox) and isNotEmpty via API viewId query', async () => {
      // Create table with checkbox and text fields
      const table = await createTable(baseId, {
        name: 'View Filter Null Test',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Done', type: FieldType.Checkbox },
          { name: 'Code', type: FieldType.SingleLineText },
        ],
        records: [
          { fields: { Name: 'row1', Done: true, Code: 'A001' } },
          { fields: { Name: 'row2', Done: false, Code: 'A002' } },
          { fields: { Name: 'row3', Code: 'A003' } },
          { fields: { Name: 'row4', Done: true } },
          { fields: { Name: 'row5' } },
        ],
      });
      tableId = table.id;
      viewId = table.defaultViewId!;

      const doneField = table.fields.find((f) => f.name === 'Done')!;
      const codeField = table.fields.find((f) => f.name === 'Code')!;

      // Set V1-style view filter: Done is [unchecked] AND Code isNotEmpty
      // V1 stores checkbox "is unchecked" as {operator: "is", value: null}
      const filterRo: IFilterRo = {
        filter: {
          conjunction: 'and',
          filterSet: [
            { fieldId: doneField.id, operator: 'is', value: null },
            { fieldId: codeField.id, operator: 'isNot', value: null },
          ],
        },
      };
      await updateViewFilter(tableId, viewId, filterRo);

      // Query records using viewId - should apply the view filter
      const result = await apiGetRecords(tableId, {
        viewId,
        fieldKeyType: FieldKeyType.Name,
      });

      // Only rows where Done is unchecked/false AND Code is not empty should match
      // row2: Done=false, Code='A002' ✓
      // row3: Done=undefined, Code='A003' ✓
      // row1: Done=true → excluded
      // row4: Done=true → excluded
      // row5: Done=undefined, Code=undefined → excluded by Code isNot null
      const records = result.data.records;
      expect(records.length).toBe(2);
      const names = records.map((r) => r.fields.Name).sort();
      expect(names).toEqual(['row2', 'row3']);
    });
  }
);
