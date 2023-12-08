import type { INestApplication } from '@nestjs/common';
import type { IViewOptionRo, IGridView, IFormView } from '@teable-group/core';
import { RowHeightLevel, ViewType } from '@teable-group/core';
import { setViewOption as apiSetViewOption } from '@teable-group/openapi';
import type * as supertest from 'supertest';
import { initApp, getView, createTable, deleteTable } from './utils/init-app';

let app: INestApplication;
let request: supertest.SuperAgentTest;
const baseId = globalThis.testConfig.baseId;

beforeAll(async () => {
  const appCtx = await initApp();
  app = appCtx.app;
  request = appCtx.request;
});

afterAll(async () => {
  await app.close();
});

async function setViewOption(tableId: string, viewId: string, viewOptionRo: IViewOptionRo) {
  const result = await apiSetViewOption(tableId, viewId, viewOptionRo);
  return result.data;
}

describe('OpenAPI ViewController (e2e) option (PUT) update grid view option', () => {
  let tableId: string;
  let viewId: string;
  let viewIds: string[];
  beforeAll(async () => {
    const result = await createTable(baseId, {
      name: 'Table',
      views: [{ type: ViewType.Grid }, { type: ViewType.Form }],
    });
    tableId = result.id;
    viewId = result.defaultViewId!;
    viewIds = result.views.map((view) => view.id);
  });
  afterAll(async () => {
    await deleteTable(baseId, tableId);
  });

  test(`/table/{tableId}/view/{viewId}/option (PUT) update option rowHeight`, async () => {
    await setViewOption(tableId, viewId, { rowHeight: RowHeightLevel.Short });
    const updatedView = await getView(tableId, viewId);
    const rowHeight = (updatedView.options as IGridView['options']).rowHeight;
    expect(rowHeight).toBe(RowHeightLevel.Short);
  });

  test(`/table/{tableId}/view/{viewId}/option (PUT) update other type options should fail`, async () => {
    const [, formViewId] = viewIds;
    await request
      .put(`/api/table/${tableId}/view/${formViewId}/option`)
      .send({ rowHeight: RowHeightLevel.Short })
      .expect(400);
  });
});

describe('OpenAPI ViewController (e2e) option (PUT) update form view option', () => {
  let tableId: string;
  let viewId: string;
  beforeAll(async () => {
    const result = await createTable(baseId, { name: 'Table', views: [{ type: ViewType.Form }] });
    tableId = result.id;
    viewId = result.defaultViewId!;
  });
  afterAll(async () => {
    await deleteTable(baseId, tableId);
  });

  test(`/table/{tableId}/view/{viewId}/option (PUT) update option coverUrl`, async () => {
    const assertUrl = 'https://test.ico';
    await setViewOption(tableId, viewId, { coverUrl: assertUrl });
    const updatedView = await getView(tableId, viewId);
    const coverUrl = (updatedView.options as IFormView['options']).coverUrl;
    expect(coverUrl).toBe(assertUrl);
  });
});
