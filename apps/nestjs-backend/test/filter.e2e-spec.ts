import type { INestApplication } from '@nestjs/common';
import { FieldType, isEmpty, type IFieldVo, type IFilterRo } from '@teable/core';
import { updateViewFilter as apiSetViewFilter } from '@teable/openapi';
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
