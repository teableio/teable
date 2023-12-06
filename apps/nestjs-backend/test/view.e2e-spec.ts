/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { ITableFullVo, IViewRo, IViewVo } from '@teable-group/core';
import { FieldType, ViewType } from '@teable-group/core';
import type supertest from 'supertest';
import { createField, getFields, initApp } from './utils/init-app';

const defaultViews = [
  {
    name: 'Grid view',
    type: ViewType.Grid,
  },
];

describe('OpenAPI ViewController (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  let request: supertest.SuperAgentTest;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;

    const result = await request.post(`/api/base/${baseId}/table`).send({
      name: 'table1',
    });
    table = result.body;
  });

  afterAll(async () => {
    const result = await request.delete(`/api/base/${baseId}/table/arbitrary/${table.id}`);
    console.log('clear table: ', result.body);

    await app.close();
  });

  it('/api/table/{tableId}/view (GET)', async () => {
    const viewsResult = await request.get(`/api/table/${table.id}/view`);
    expect(viewsResult.body).toMatchObject(defaultViews);
  });

  it('/api/table/{tableId}/view (POST)', async () => {
    const viewRo: IViewRo = {
      name: 'New view',
      description: 'the new view',
      type: ViewType.Grid,
    };

    await request.post(`/api/table/${table.id}/view`).send(viewRo).expect(201);

    const result = await request
      .get(`/api/table/${table.id}/view`)
      .query({
        skip: 0,
        take: 1000,
      })
      .expect(200);

    expect(result.body).toMatchObject([
      ...defaultViews,
      {
        name: 'New view',
        description: 'the new view',
        type: ViewType.Grid,
      },
    ]);
    // console.log('result: ', result.body);
  });

  it('fields in new view should sort by created time and primary field is always first', async () => {
    const viewRo: IViewRo = {
      name: 'New view',
      description: 'the new view',
      type: ViewType.Grid,
    };

    const oldFields = await getFields(request, table.id, table.views[0].id);
    oldFields.push(await createField(request, table.id, { type: FieldType.SingleLineText }));
    oldFields.push(await createField(request, table.id, { type: FieldType.SingleLineText }));
    oldFields.push(await createField(request, table.id, { type: FieldType.SingleLineText }));

    const result = await request.post(`/api/table/${table.id}/view`).send(viewRo).expect(201);
    const newView = result.body as IViewVo;
    const newFields = await getFields(request, table.id, newView.id);

    expect(newFields).toMatchObject(oldFields);
  });
});
