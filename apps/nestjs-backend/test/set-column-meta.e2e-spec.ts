import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, IFormColumnMeta, IGridColumnMeta } from '@teable/core';
import { StatisticsFunc, ViewType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { sortBy } from 'lodash';
import {
  initApp,
  updateViewColumnMeta,
  getFields,
  getView,
  createTable,
  permanentDeleteTable,
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

describe('OpenAPI ViewController (e2e) columnMeta (PUT) update order', () => {
  let tableId: string;
  let viewId: string;
  let tableMeta: ITableFullVo;
  beforeEach(async () => {
    const result = await createTable(baseId, { name: 'table1' });
    tableId = result.id;
    viewId = result.defaultViewId!;
    tableMeta = result;
  });
  afterEach(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  test(`/table/{tableId}/view/{viewId}/columnMeta (PUT) test update order and field should return by order`, async () => {
    const { views } = tableMeta;
    const { columnMeta } = views[0];
    const fieldColumnMetas = Object.entries(columnMeta!).map(([fieldId, columnMeta]) => ({
      fieldId,
      columnMeta,
    }));
    await updateViewColumnMeta(tableId, viewId, [
      {
        fieldId: fieldColumnMetas[0].fieldId,
        columnMeta: {
          order: 10,
        },
      },
    ]);
    const updatedView = await getView(tableId, viewId);
    const updatedOrder = updatedView.columnMeta[fieldColumnMetas[0].fieldId].order;

    const fields: IFieldVo[] = await getFields(tableId, viewId);

    const sortedFields = sortBy(fields, (field) => {
      return updatedView.columnMeta[field.id].order;
    }).map((field) => field.id);

    const fieldIds = fields.map((field) => field.id);
    expect(updatedOrder).toBe(10);
    expect(sortedFields).toEqual(fieldIds);
  });
});

describe('OpenAPI ViewController (e2e) columnMeta(PUT) update hidden', () => {
  let tableId: string;
  let viewId: string;
  let tableMeta: ITableFullVo;
  beforeEach(async () => {
    const result = await createTable(baseId, { name: 'table2' });
    tableId = result.id;
    viewId = result.defaultViewId!;
    tableMeta = result;
  });
  afterEach(async () => {
    await permanentDeleteTable(baseId, tableId);
  });
  test(`/table/{tableId}/view/{viewId}/columnMeta (PUT) test update hidden`, async () => {
    const { views } = tableMeta;
    const { columnMeta } = views[0];
    const fieldColumnMetas = Object.entries(columnMeta!).map(([fieldId, meta]) => ({
      fieldId: fieldId,
      meta: meta,
    }));
    await updateViewColumnMeta(tableId, viewId, [
      {
        fieldId: fieldColumnMetas[1].fieldId,
        columnMeta: {
          hidden: true,
        },
      },
    ]);
    const updatedView = await getView(tableId, viewId);
    const fieldVisible = (updatedView.columnMeta as IGridColumnMeta)[fieldColumnMetas[1].fieldId]
      .hidden;

    expect(fieldVisible).toBe(true);
  });

  test(`/table/{tableId}/view/{viewId}/columnMeta (PUT) should not hidden primary field for grid view`, async () => {
    const { fields } = tableMeta;
    const primaryFieldId = fields.find((field) => field.isPrimary)?.id;
    const fieldColumnMetas = [
      {
        fieldId: primaryFieldId as string,
        columnMeta: {
          hidden: true,
        },
      },
    ];
    await expect(updateViewColumnMeta(tableId, viewId, fieldColumnMetas)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('OpenAPI ViewController (e2e) columnMeta(PUT) update width', () => {
  let tableId: string;
  let viewId: string;
  let tableMeta: ITableFullVo;
  beforeEach(async () => {
    const result = await createTable(baseId, { name: 'table3' });
    tableId = result.id;
    viewId = result.defaultViewId!;
    tableMeta = result;
  });
  afterEach(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  test(`/table/{tableId}/view/{viewId}/columnMeta (PUT) test update width`, async () => {
    const { views } = tableMeta;
    const { columnMeta } = views[0];
    const fieldColumnMetas = Object.entries(columnMeta!).map(([fieldId, meta]) => ({
      fieldId: fieldId,
      meta: meta,
    }));
    await updateViewColumnMeta(tableId, viewId, [
      {
        fieldId: fieldColumnMetas[0].fieldId,
        columnMeta: {
          width: 200,
        },
      },
    ]);
    const updatedView = await getView(tableId, viewId);
    const fieldVisible = (updatedView.columnMeta as IGridColumnMeta)[fieldColumnMetas[0].fieldId]
      .width;
    expect(fieldVisible).toBe(200);
  });
});

describe('OpenAPI ViewController (e2e) columnMeta(PUT) update statisticFunc', () => {
  let tableId: string;
  let viewId: string;
  let tableMeta: ITableFullVo;
  beforeEach(async () => {
    const result = await createTable(baseId, { name: 'table4' });
    tableId = result.id;
    viewId = result.defaultViewId!;
    tableMeta = result;
  });
  afterEach(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  test(`/table/{tableId}/view/{viewId}/columnMeta (PUT) test update statisticFunc`, async () => {
    const { views } = tableMeta;
    const { columnMeta } = views[0];
    const fieldColumnMetas = Object.entries(columnMeta!).map(([fieldId, meta]) => ({
      fieldId: fieldId,
      meta: meta,
    }));
    await updateViewColumnMeta(tableId, viewId, [
      {
        fieldId: fieldColumnMetas[0].fieldId,
        columnMeta: {
          statisticFunc: StatisticsFunc.Empty,
        },
      },
    ]);
    const updatedView = await getView(tableId, viewId);
    const fieldStatisticFunc = (updatedView.columnMeta as IGridColumnMeta)[
      fieldColumnMetas[0].fieldId
    ].statisticFunc;
    expect(fieldStatisticFunc).toBe(StatisticsFunc.Empty);
  });
});

describe('OpenAPI ViewController (e2e) columnMeta(PUT) update required for the form view', () => {
  let tableId: string;
  let viewId: string;
  let tableMeta: ITableFullVo;
  beforeEach(async () => {
    const result = await createTable(baseId, {
      name: 'table5',
      views: [
        {
          name: 'Form view',
          type: ViewType.Form,
          columnMeta: {},
        },
      ],
    });
    tableId = result.id;
    viewId = result.defaultViewId!;
    tableMeta = result;
  });
  afterEach(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  test(`/table/{tableId}/view/{viewId}/columnMeta (PUT) test required`, async () => {
    const { views } = tableMeta;
    const { columnMeta } = views[0];
    const fieldColumnMetas = Object.entries(columnMeta!).map(([fieldId, meta]) => ({
      fieldId: fieldId,
      meta: meta,
    }));
    await updateViewColumnMeta(tableId, viewId, [
      {
        fieldId: fieldColumnMetas[0].fieldId,
        columnMeta: {
          required: true,
        },
      },
    ]);
    const updatedView = await getView(tableId, viewId);
    const fieldRequired = (updatedView.columnMeta as IFormColumnMeta)[fieldColumnMetas[0].fieldId]
      .required;
    expect(fieldRequired).toBe(true);
  });
});

describe('OpenAPI ViewController (e2e) columnMeta(PUT) update visible for the form view', () => {
  let tableId: string;
  let viewId: string;
  let tableMeta: ITableFullVo;
  beforeEach(async () => {
    const result = await createTable(baseId, {
      name: 'Test table for form',
      views: [
        {
          name: 'Form view',
          type: ViewType.Form,
          columnMeta: {},
        },
      ],
    });
    tableId = result.id;
    viewId = result.defaultViewId!;
    tableMeta = result;
  });
  afterEach(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  test(`/table/{tableId}/view/{viewId}/columnMeta (PUT) test visible`, async () => {
    const { views } = tableMeta;
    const { columnMeta } = views[0];
    const fieldColumnMetas = Object.entries(columnMeta!).map(([fieldId, meta]) => ({
      fieldId: fieldId,
      meta: meta,
    }));
    await updateViewColumnMeta(tableId, viewId, [
      {
        fieldId: fieldColumnMetas[0].fieldId,
        columnMeta: {
          visible: true,
        },
      },
    ]);
    const updatedView = await getView(tableId, viewId);
    const fieldVisible = (updatedView.columnMeta as IFormColumnMeta)[fieldColumnMetas[0].fieldId]
      .visible;
    expect(fieldVisible).toBe(true);
  });
});

describe('OpenAPI ViewController (e2e) columnMeta(PUT) update multiple single', () => {
  let tableId: string;
  let viewId: string;
  let tableMeta: ITableFullVo;
  beforeEach(async () => {
    const result = await createTable(baseId, { name: 'table6' });
    tableId = result.id;
    viewId = result.defaultViewId!;
    tableMeta = result;
  });
  afterEach(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  test(`/table/{tableId}/view/{viewId}/columnMeta (PUT) test update should not cover`, async () => {
    const { views } = tableMeta;
    const { columnMeta } = views[0];
    const fieldColumnMetas = Object.entries(columnMeta!).map(([fieldId, meta]) => ({
      fieldId: fieldId,
      meta: meta,
    }));

    await updateViewColumnMeta(tableId, viewId, [
      {
        fieldId: fieldColumnMetas[0].fieldId,
        columnMeta: {
          order: 7,
        },
      },
    ]);

    await updateViewColumnMeta(tableId, viewId, [
      {
        fieldId: fieldColumnMetas[0].fieldId,
        columnMeta: {
          required: true,
        },
      },
    ]);

    await updateViewColumnMeta(tableId, viewId, [
      {
        fieldId: fieldColumnMetas[0].fieldId,
        columnMeta: {
          width: 100,
        },
      },
    ]);

    const assertData = {
      required: true,
      width: 100,
      order: 7,
    };

    const updatedView = await getView(tableId, viewId);
    const fieldColumnMeta = updatedView.columnMeta[fieldColumnMetas[0].fieldId];
    expect(fieldColumnMeta).toEqual(assertData);
  });
});

describe('OpenAPI ViewController (e2e) columnMeta(PUT) multiple update', () => {
  let tableId: string;
  let viewId: string;
  let tableMeta: ITableFullVo;
  beforeEach(async () => {
    const result = await createTable(baseId, { name: 'table7' });
    tableId = result.id;
    viewId = result.defaultViewId!;
    tableMeta = result;
  });
  afterEach(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  test(`/table/{tableId}/view/{viewId}/columnMeta (PUT) test multiple data`, async () => {
    const { views } = tableMeta;
    const { columnMeta } = views[0];
    const fieldColumnMetas = Object.entries(columnMeta!).map(([fieldId, meta]) => ({
      fieldId: fieldId,
      meta: meta,
    }));
    const assertData = {
      width: 200,
      statisticFunc: StatisticsFunc.Empty,
      hidden: true,
      order: 100,
    };
    await updateViewColumnMeta(tableId, viewId, [
      {
        fieldId: fieldColumnMetas[1].fieldId,
        columnMeta: {
          ...assertData,
        },
      },
    ]);
    const updatedView = await getView(tableId, viewId);
    const updatedColumnMeta = updatedView.columnMeta[fieldColumnMetas[1].fieldId];
    expect(updatedColumnMeta).toEqual(assertData);
  });
});

describe('OpenAPI ViewController (e2e) columnMeta(PUT) params validate', () => {
  let tableId: string;
  let viewId: string;
  beforeEach(async () => {
    const result = await createTable(baseId, { name: 'table8' });
    tableId = result.id;
    viewId = result.defaultViewId!;
  });
  afterEach(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  test(`/table/{tableId}/view/{viewId}/columnMeta (PUT) test validate fieldId legitimacy`, async () => {
    const columnMeta = {
      width: 200,
    };

    await expect(
      updateViewColumnMeta(tableId, viewId, [{ fieldId: 'fakeFieldID', columnMeta }])
    ).rejects.toMatchObject({
      status: 400,
    });
  });
});
