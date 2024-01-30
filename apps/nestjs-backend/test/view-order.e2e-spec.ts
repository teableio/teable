import type { INestApplication } from '@nestjs/common';
import { ViewType } from '@teable/core';
import { updateViewOrder as apiSetViewOrder } from '@teable/openapi';
import { initApp, createTable, deleteTable, getViews } from './utils/init-app';

let app: INestApplication;
const baseId = globalThis.testConfig.baseId;

beforeAll(async () => {
  const appCtx = await initApp();
  app = appCtx.app;
});

afterAll(async () => {
  await app.close();
});

describe('/table/{tableId}/view/{viewId}/order OpenAPI ViewController (e2e) order (Patch) update grid view order', () => {
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

  it(`should update view order`, async () => {
    const view2Id = viewIds[1];

    const assertViews = [view2Id, viewId];
    await apiSetViewOrder(tableId, view2Id, { order: -1 });

    const result = await getViews(tableId);

    const views = result.map(({ id }) => id);

    expect(result[0].order).toBe(-1);
    expect(assertViews).toEqual(views);
  });

  it(`should return 400, when update duplicate order`, async () => {
    const view2Id = viewIds[1];
    await expect(apiSetViewOrder(tableId, view2Id, { order: 0 })).rejects.toMatchObject({
      status: 400,
    });
  });
});
