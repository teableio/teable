import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TableModule } from '../src/features/table/table.module';

describe('OpenAPI RecordController (e2e)', () => {
  let app: INestApplication;
  let tableId = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TableModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  it('/api/table/{tableId}/record (POST)', async () => {
    await request(app.getHttpServer())
      .post(`/api/table/${tableId}/record`)
      .send({
        records: [
          {
            fields: {},
          },
        ],
      })
      .expect(201)
      .expect({});
  });
});
