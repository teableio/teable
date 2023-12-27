import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, IFilterRo } from '@teable-group/core';
import { setViewFilter as apiSetViewFilter } from '@teable-group/openapi';
import { initApp, getView, createTable, deleteTable } from './utils/init-app';

let app: INestApplication;
const baseId = globalThis.testConfig.baseId;

beforeAll(async () => {
  const appCtx = await initApp();
  app = appCtx.app;
});

afterAll(async () => {
  await app.close();
});

async function setViewFilter(tableId: string, viewId: string, filterRo: IFilterRo) {
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
    await deleteTable(baseId, tableId);
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
    await setViewFilter(tableId, viewId, assertFilter);
    const updatedView = await getView(tableId, viewId);
    const viewFilter = updatedView.filter;
    expect(viewFilter).toEqual(assertFilter);
  });
});
