/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IColumn, IFieldVo, ITableFullVo, IViewRo } from '@teable/core';
import { FieldType, ViewType } from '@teable/core';
import { updateViewDescription, updateViewName, updateViewOrder } from '@teable/openapi';
import {
  createField,
  getFields,
  initApp,
  createView,
  deleteTable,
  createTable,
  getViews,
  getView,
} from './utils/init-app';

const defaultViews = [
  {
    name: 'Grid view',
    type: ViewType.Grid,
  },
];

describe('OpenAPI ViewController (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    table = await createTable(baseId, { name: 'table1' });
  });

  afterEach(async () => {
    const result = await deleteTable(baseId, table.id);
    console.log('clear table: ', result);
  });

  it('/api/table/{tableId}/view (GET)', async () => {
    const viewsResult = await getViews(table.id);
    expect(viewsResult).toMatchObject(defaultViews);
  });

  it('/api/table/{tableId}/view (POST)', async () => {
    const viewRo: IViewRo = {
      name: 'New view',
      description: 'the new view',
      type: ViewType.Grid,
    };

    await createView(table.id, viewRo);

    const result = await getViews(table.id);
    expect(result).toMatchObject([
      ...defaultViews,
      {
        name: 'New view',
        description: 'the new view',
        type: ViewType.Grid,
      },
    ]);
  });

  it('should update view simple properties', async () => {
    const viewRo: IViewRo = {
      name: 'New view',
      description: 'the new view',
      type: ViewType.Grid,
    };

    const view = await createView(table.id, viewRo);

    await updateViewName(table.id, view.id, { name: 'New view 2' });
    await updateViewDescription(table.id, view.id, { description: 'description2' });
    const viewNew = await getView(table.id, view.id);

    expect(viewNew.name).toEqual('New view 2');
    expect(viewNew.description).toEqual('description2');
  });

  it('should create view with field order', async () => {
    // get fields
    const fields = await getFields(table.id);
    const testFieldId = fields?.[0].id;
    const assertOrder = 10;
    const columnMeta = fields.reduce<Record<string, IColumn>>(
      (pre, cur, index) => {
        pre[cur.id] = {} as IColumn;
        pre[cur.id].order = index === 0 ? assertOrder : index;
        return pre;
      },
      {} as Record<string, IColumn>
    );

    const viewResponse = await createView(table.id, {
      name: 'view',
      columnMeta,
      type: ViewType.Grid,
    });

    const { columnMeta: columnMetaResponse } = viewResponse;
    const order = columnMetaResponse?.[testFieldId]?.order;
    expect(order).toEqual(assertOrder);
    expect(fields.length).toEqual(Object.keys(columnMetaResponse).length);
  });

  it('fields in new view should sort by created time and primary field is always first', async () => {
    const viewRo: IViewRo = {
      name: 'New view',
      description: 'the new view',
      type: ViewType.Grid,
    };

    const oldFields: IFieldVo[] = [];
    oldFields.push(await createField(table.id, { type: FieldType.SingleLineText }));
    oldFields.push(await createField(table.id, { type: FieldType.SingleLineText }));
    oldFields.push(await createField(table.id, { type: FieldType.SingleLineText }));

    const newView = await createView(table.id, viewRo);
    const newFields = await getFields(table.id, newView.id);

    expect(newFields.slice(3)).toMatchObject(oldFields);
  });

  it('re-order view', async () => {
    const view1 = { id: table.views[0].id };

    const view2 = {
      id: (
        await createView(table.id, {
          name: 'view',
          type: ViewType.Grid,
        })
      ).id,
    };

    const view3 = {
      id: (
        await createView(table.id, {
          name: 'view',
          type: ViewType.Grid,
        })
      ).id,
    };

    await updateViewOrder(table.id, view3.id, { anchorId: view2.id, position: 'before' });
    const views = await getViews(table.id);
    expect(views).toMatchObject([view1, view3, view2]);

    await updateViewOrder(table.id, view3.id, { anchorId: view1.id, position: 'before' });
    const views2 = await getViews(table.id);
    expect(views2).toMatchObject([view3, view1, view2]);

    await updateViewOrder(table.id, view3.id, { anchorId: view1.id, position: 'after' });
    const views3 = await getViews(table.id);
    expect(views3).toMatchObject([view1, view3, view2]);

    await updateViewOrder(table.id, view3.id, { anchorId: view2.id, position: 'after' });
    const views4 = await getViews(table.id);
    expect(views4).toMatchObject([view1, view2, view3]);
  });
});
