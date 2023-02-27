import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ViewType } from '@teable-group/core';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { TableModule } from '../src/features/table/table.module';
import type { CreateViewRo } from '../src/features/view/model/create-view.ro';

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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TableModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(json({ limit: '50mb' }));
    app.use(urlencoded({ limit: '50mb', extended: true }));
    await app.init();

    const result = await request(app.getHttpServer()).post('/api/table').send({
      name: 'table1',
    });
    tableId = result.body.id;
  });

  afterAll(async () => {
    const result = await request(app.getHttpServer()).delete(`/api/table/arbitrary/${tableId}`);
    console.log('clear table: ', result.body);
  });

  it('/api/table/{tableId}/view (GET)', async () => {
    const viewsResult = await request(app.getHttpServer()).get(`/api/table/${tableId}/view`);
    expect(viewsResult.body).toMatchObject(defaultViews);
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
      .expect({});

    const result = await request(app.getHttpServer())
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
