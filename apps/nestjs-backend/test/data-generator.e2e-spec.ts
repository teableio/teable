import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType } from '@teable-group/core';
import { json, urlencoded } from 'express';
import request from 'supertest';
import type { FieldVo } from '../src/features/field/model/field.vo';
import { TableModule } from '../src/features/table/table.module';

jest.setTimeout(100000000);

describe('Performance test data generator', () => {
  let app: INestApplication;
  let tableId = '';
  let fields: FieldVo[] = [];

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

    const fieldsResult = await request(app.getHttpServer()).get(`/api/table/${tableId}/field`);
    fields = fieldsResult.body;
    console.log('fields: ', fields);
  });

  function addRecords(count: number) {
    const records = Array.from({ length: count }).map((_, i) => {
      const value = fields.reduce<{ [fieldId: string]: unknown }>((acc, field) => {
        switch (field.type) {
          case FieldType.SingleLineText:
            acc[field.id] = 'New Record' + new Date();
            break;
          case FieldType.Number:
            acc[field.id] = i;
            break;
          case FieldType.SingleSelect:
            acc[field.id] = ['light', 'medium', 'heavy'][i % 3];
            break;
        }
        return acc;
      }, {});
      return { fields: value };
    });

    return request(app.getHttpServer()).post(`/api/table/${tableId}/record`).send({
      records,
    });
  }

  it('/api/table/{tableId}/record (POST) (1000x)', async () => {
    const count = 1000;
    console.time(`create ${count} records`);
    for (let i = 0; i < count / 1000; i++) {
      await addRecords(1000).expect(201).expect({});
    }
    console.timeEnd(`create ${count} records`);
  });
});
