import type { INestApplication } from '@nestjs/common';
import { ViewType } from '@teable-group/core';
import request from 'supertest';
import type { CreateViewRo } from '../src/features/view/model/create-view.ro';
import { initApp } from './init-app';

const defaultViews = [
  {
    name: 'GridView',
    type: ViewType.Grid,
  },
];

describe('OpenAPI ViewController (e2e)', () => {
  let app: INestApplication;
  let tableId = '';

  beforeAll(async () => {
    app = await initApp();

    const result = await request(app.getHttpServer()).post('/api/table').send({
      name: 'table1',
    });
    tableId = result.body.data.id;
  });

  afterAll(async () => {
    const result = await request(app.getHttpServer()).delete(`/api/table/arbitrary/${tableId}`);
    console.log('clear table: ', result.body.data);
  });

  it('/api/table/{tableId}/view (GET)', async () => {
    const viewsResult = await request(app.getHttpServer()).get(`/api/table/${tableId}/view`);
    expect(viewsResult.body.data).toMatchObject(defaultViews);
  });

  it('/api/table/{tableId}/view (POST)', async () => {
    const viewRo: CreateViewRo = {
      name: 'New view',
      description: 'the new view',
      type: ViewType.Grid,
    };

    await request(app.getHttpServer())
      .post(`/api/table/${tableId}/view`)
      .send(viewRo)
      .expect(201)
      .expect({ success: true });

    const result = await request(app.getHttpServer())
      .get(`/api/table/${tableId}/view`)
      .query({
        skip: 0,
        take: 1000,
      })
      .expect(200);

    expect(result.body.data).toMatchObject([
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
