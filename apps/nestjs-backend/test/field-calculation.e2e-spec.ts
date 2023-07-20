/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IRecordVo } from '@teable-group/core';
import { FieldKeyType, FieldType } from '@teable-group/core';
import type { FieldVo } from 'src/features/field/model/field.vo';
import type { RecordsVo } from 'src/features/record/open-api/record.vo';
import type { UpdateRecordRo } from 'src/features/record/update-record.ro';
import request from 'supertest';
import type { CreateFieldRo } from '../src/features/field/model/create-field.ro';
import { initApp } from './utils/init-app';

describe('OpenAPI Field calculation (e2e)', () => {
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
    await request(app.getHttpServer()).delete(`/api/table/arbitrary/${tableId}`);
  });

  async function updateRecordByApi(
    tableId: string,
    recordId: string,
    fieldId: string,
    newValues: any
  ): Promise<IRecordVo> {
    return (
      await request(app.getHttpServer())
        .put(`/api/table/${tableId}/record/${recordId}`)
        .send({
          fieldKeyType: FieldKeyType.Id,
          record: {
            fields: {
              [fieldId]: newValues,
            },
          },
        } as UpdateRecordRo)
        .expect(200)
    ).body.data;
  }

  async function getFields(tableId: string) {
    const fieldResult = await request(app.getHttpServer())
      .get(`/api/table/${tableId}/field`)
      .expect(200);
    return fieldResult.body.data as FieldVo[];
  }

  async function getRecords(tableId: string) {
    const recordsResult = await request(app.getHttpServer())
      .get(`/api/table/${tableId}/record`)
      .expect(200);
    return recordsResult.body.data as RecordsVo;
  }

  it('should calculate when add a non-reference formula field', async () => {
    const fieldRo: CreateFieldRo = {
      name: 'New formula field',
      type: FieldType.Formula,
      options: {
        expression: '1 + 1',
        formatting: {
          precision: 2,
        },
      },
    };

    const fieldCreateResult = await request(app.getHttpServer())
      .post(`/api/table/${tableId}/field`)
      .send(fieldRo)
      .expect(201);
    const fieldVo: FieldVo = fieldCreateResult.body.data;

    const recordsResult = await request(app.getHttpServer())
      .get(`/api/table/${tableId}/record`)
      .expect(200);
    const recordsVo: RecordsVo = recordsResult.body.data;
    const equal = recordsVo.records.every((record) => record.fields[fieldVo.name] === 2);
    expect(equal).toBeTruthy();
  });

  it('should calculate when add a referenced formula field', async () => {
    const fieldsVo = await getFields(tableId);
    const recordsVo = await getRecords(tableId);

    await updateRecordByApi(tableId, recordsVo.records[0].id, fieldsVo[0].id, 'A1');
    await updateRecordByApi(tableId, recordsVo.records[1].id, fieldsVo[0].id, 'A2');
    await updateRecordByApi(tableId, recordsVo.records[2].id, fieldsVo[0].id, 'A3');

    const fieldRo: CreateFieldRo = {
      name: 'New formula field',
      type: FieldType.Formula,
      options: {
        expression: `{${fieldsVo[0].id}}`,
      },
    };

    const fieldCreateResult = await request(app.getHttpServer())
      .post(`/api/table/${tableId}/field`)
      .send(fieldRo)
      .expect(201);
    const fieldVo: FieldVo = fieldCreateResult.body.data;
    const recordsVoAfter = await getRecords(tableId);

    expect(recordsVoAfter.records[0].fields[fieldVo.name]).toEqual('A1');
    expect(recordsVoAfter.records[1].fields[fieldVo.name]).toEqual('A2');
    expect(recordsVoAfter.records[2].fields[fieldVo.name]).toEqual('A3');
  });
});
