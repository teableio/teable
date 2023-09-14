import type { INestApplication } from '@nestjs/common';
import type { IViewRo } from '@teable-group/core';
import { ViewType } from '@teable-group/core';
import type supertest from 'supertest';
import { initApp } from './utils/init-app';

const defaultViews = [
  {
    name: 'GridView',
    type: ViewType.Grid,
  },
];

describe('OpenAPI ViewController (e2e)', () => {
  let app: INestApplication;
  let tableId = '';
  let request: supertest.SuperAgentTest;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;

    const result = await request.post(`/api/base/${baseId}/table`).send({
      name: 'table1',
    });
    tableId = result.body.id;
  });

  afterAll(async () => {
    const result = await request.delete(`/api/base/${baseId}/table/arbitrary/${tableId}`);
    console.log('clear table: ', result.body);

    await app.close();
  });

  it('/api/table/{tableId}/view (GET)', async () => {
    const viewsResult = await request.get(`/api/table/${tableId}/view`);
    expect(viewsResult.body).toMatchObject(defaultViews);
  });

  it('/api/table/{tableId}/view (POST)', async () => {
    const viewRo: IViewRo = {
      name: 'New view',
      description: 'the new view',
      type: ViewType.Grid,
    };

    await request.post(`/api/table/${tableId}/view`).send(viewRo).expect(201);

    const result = await request
      .get(`/api/table/${tableId}/view`)
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
});
