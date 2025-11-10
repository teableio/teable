import type { INestApplication } from '@nestjs/common';
import type { IViewOptions, IGridView, IFormView } from '@teable/core';
import { RowHeightLevel, ViewType } from '@teable/core';
import { updateViewOptions as apiSetViewOption } from '@teable/openapi';
import {
  initApp,
  getView,
  getFields,
  createTable,
  permanentDeleteTable,
  updateViewColumnMeta,
  deleteField,
} from './utils/init-app';

let app: INestApplication;
const baseId = globalThis.testConfig.baseId;

beforeAll(async () => {
  const appCtx = await initApp();
  app = appCtx.app;
});

afterAll(async () => {
  await app.close();
});

async function updateViewOptions(tableId: string, viewId: string, viewOptionRo: IViewOptions) {
  const result = await apiSetViewOption(tableId, viewId, { options: viewOptionRo });
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
    await permanentDeleteTable(baseId, tableId);
  });

  it(`/table/{tableId}/view/{viewId}/option (PUT) update option rowHeight`, async () => {
    await updateViewOptions(tableId, viewId, { rowHeight: RowHeightLevel.Short });
    const updatedView = await getView(tableId, viewId);
    const rowHeight = (updatedView.options as IGridView['options']).rowHeight;
    expect(rowHeight).toBe(RowHeightLevel.Short);
  });

  it(`/table/{tableId}/view/{viewId}/option (PUT) update other type options should return 400`, async () => {
    const [, formViewId] = viewIds;
    await expect(
      updateViewOptions(tableId, formViewId, { rowHeight: RowHeightLevel.Short })
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it(`/table/{tableId}/view/{viewId}/option (PUT) update option frozenFieldId`, async () => {
    const fields = await getFields(tableId);
    const anchorFieldId = fields[1]?.id ?? fields[0].id;
    await updateViewOptions(tableId, viewId, { frozenFieldId: anchorFieldId });
    const updatedView = await getView(tableId, viewId);
    const frozenFieldId = (updatedView.options as IGridView['options']).frozenFieldId;
    expect(frozenFieldId).toBe(anchorFieldId);
  });

  it(`/table/{tableId}/view/{viewId}/columnMeta (PUT) changing frozen field order should shift frozenFieldId to previous`, async () => {
    const initialView = await getView(tableId, viewId);
    const originOrders = Object.entries(initialView.columnMeta)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([fieldId]) => fieldId);
    const targetFrozen = originOrders[1] ?? originOrders[0];
    const prevNeighbor = originOrders[0];

    await updateViewOptions(tableId, viewId, { frozenFieldId: targetFrozen });

    await updateViewColumnMeta(tableId, viewId, [
      { fieldId: targetFrozen, columnMeta: { order: 9999 } },
    ]);

    const updatedView = await getView(tableId, viewId);
    const frozenFieldId = (updatedView.options as IGridView['options']).frozenFieldId;
    expect(frozenFieldId).toBe(prevNeighbor);
  });

  it(`/table/{tableId}/field/{fieldId} (DELETE) deleting frozen field should update or clear frozenFieldId`, async () => {
    const initialView = await getView(tableId, viewId);
    const originOrders = Object.entries(initialView.columnMeta)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([fieldId]) => fieldId);

    const middleFrozen = originOrders[1];
    const expectedAfterDelete = originOrders[0];
    await updateViewOptions(tableId, viewId, { frozenFieldId: middleFrozen });
    await deleteField(tableId, middleFrozen);
    const viewAfterDelete = await getView(tableId, viewId);
    const frozenAfter = (viewAfterDelete.options as IGridView['options']).frozenFieldId;
    expect(frozenAfter).toBe(expectedAfterDelete);
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
    await permanentDeleteTable(baseId, tableId);
  });

  it(`/table/{tableId}/view/{viewId}/option (PUT) update option coverUrl`, async () => {
    const assertUrl = '/form/test';
    await updateViewOptions(tableId, viewId, { coverUrl: assertUrl });
    const updatedView = await getView(tableId, viewId);
    const coverUrl = (updatedView.options as IFormView['options']).coverUrl;
    expect(coverUrl?.endsWith(assertUrl)).toBe(true);
    expect(coverUrl?.startsWith('http://')).toBe(true);
  });

  it(`/table/{tableId}/view/{viewId}/option (PUT) update option logoUrl`, async () => {
    const assertUrl = '/form/test';
    await updateViewOptions(tableId, viewId, { logoUrl: assertUrl });
    const updatedView = await getView(tableId, viewId);
    const logoUrl = (updatedView.options as IFormView['options']).logoUrl;
    expect(logoUrl?.endsWith(assertUrl)).toBe(true);
    expect(logoUrl?.startsWith('http://')).toBe(true);
  });

  it(`/table/{tableId}/view/{viewId}/option (PUT) update option submitLabel`, async () => {
    const assertLabel = 'Confirm';
    await updateViewOptions(tableId, viewId, { submitLabel: assertLabel });
    const updatedView = await getView(tableId, viewId);
    const submitLabel = (updatedView.options as IFormView['options']).submitLabel;
    expect(submitLabel).toBe(assertLabel);
  });
});
