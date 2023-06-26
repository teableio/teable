/**
 * test case for simulate frontend collaboration data flow
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, IRecord, IRecordSnapshot } from '@teable-group/core';
import {
  generateTransactionKey,
  OpBuilder,
  IdPrefix,
  FieldType,
  Relationship,
} from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import request from 'supertest';
import type { CreateFieldRo } from '../src/features/field/model/create-field.ro';
import type { LinkFieldDto } from '../src/features/field/model/field-dto/link-field.dto';
import type { UpdateRecordRo } from '../src/features/record/update-record.ro';
import { ShareDbService } from '../src/share-db/share-db.service';
import { initApp } from './init-app';

describe('OpenAPI link (e2e)', () => {
  let app: INestApplication;
  let table1Id = '';
  let table2Id = '';
  let shareDbService!: ShareDbService;
  jest.useRealTimers();
  async function wait(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
  beforeAll(async () => {
    app = await initApp();
    shareDbService = app.get(ShareDbService);
  });

  afterAll(async () => {
    app.close();
  });

  afterEach(async () => {
    await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table1Id}`);
    await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table2Id}`);
  });

  describe('link field cell update', () => {
    let ctx: {
      numberFieldRo: CreateFieldRo;
      textFieldRo: CreateFieldRo;
      table1Records: IRecord[];
      table1Fields: IFieldVo[];
      table1linkField: LinkFieldDto;
      table2LinkFieldRo: CreateFieldRo;
      table2Id: string;
      table2Records: IRecord[];
      table2Fields: IFieldVo[];
    } = {} as any;
    beforeEach(async () => {
      const numberFieldRo: CreateFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          precision: 1,
        },
      };

      const textFieldRo: CreateFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const createTable1Result = await request(app.getHttpServer())
        .post('/api/table')
        .send({
          name: 'table1',
          fields: [textFieldRo, numberFieldRo],
        })
        .expect(201);

      table1Id = createTable1Result.body.data.id;
      const table1Records = createTable1Result.body.data.data.records;

      const table2LinkFieldRo: CreateFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1Id,
        },
      };

      // table2 link manyOne table1
      const createTable2Result = await request(app.getHttpServer())
        .post('/api/table')
        .send({
          name: 'table2',
          fields: [textFieldRo, numberFieldRo, table2LinkFieldRo],
        })
        .expect(201);
      table2Id = createTable2Result.body.data.id;

      const getFields1Result = await request(app.getHttpServer())
        .get(`/api/table/${table1Id}/field`)
        .expect(200);

      const table1linkField = getFields1Result.body.data[2];
      const table1Fields = getFields1Result.body.data;

      const table2Records = createTable2Result.body.data.data.records;
      const table2Fields = createTable2Result.body.data.fields;
      // table2 link field first record link to table1 first record
      // t2[0](many) -> t1[0](one)
      await request(app.getHttpServer())
        .put(`/api/table/${table2Id}/record/${table2Records[0].id}`)
        .send({
          record: {
            fields: {
              [table2LinkFieldRo.name]: { title: 'test', id: table1Records[0].id },
            },
          },
        } as UpdateRecordRo)
        .expect(200);

      const table1RecordResult = await request(app.getHttpServer())
        .get(`/api/table/${table1Id}/record/${table1Records[0].id}`)
        .expect(200);

      expect(table1RecordResult.body.data.record.fields[table1linkField.name]).toEqual([
        {
          id: table2Records[0].id,
        },
      ]);

      ctx = {
        numberFieldRo,
        textFieldRo,
        table2LinkFieldRo,
        table1linkField,
        table1Records,
        table1Fields,
        table2Id,
        table2Records,
        table2Fields,
      };
    });

    it('should update foreign link field when set a new link in to link field cell', async () => {
      const connection = shareDbService.connect();
      const collection = `${IdPrefix.Record}_${table2Id}`;
      // t2[0](many) -> t1[1](one)
      const data = await new Promise<IRecordSnapshot>((resolve, reject) => {
        const doc: Doc<IRecordSnapshot> = connection.get(collection, ctx.table2Records[0].id);
        doc.fetch((err) => {
          if (err) {
            return reject(err);
          }
          const op = OpBuilder.editor.setRecord.build({
            fieldId: ctx.table2Fields[2].id,
            oldCellValue: doc.data.record.fields[ctx.table2Fields[2].id],
            newCellValue: { title: 'test', id: ctx.table1Records[1].id },
          });

          console.log('going to submit op to shareDB directly', op);
          doc.submitOp(op, { transactionKey: generateTransactionKey(), opCount: 1 }, (err) => {
            if (err) {
              return reject(err);
            }
            resolve(doc.data);
          });
        });
      });

      console.log('opSubmitData', data.record.fields);
      // t2[0](many) -> t1[1](one)
      await request(app.getHttpServer())
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.table2LinkFieldRo.name]: { title: 'test', id: ctx.table1Records[1].id },
            },
          },
        } as UpdateRecordRo)
        .expect(200);

      await wait(200);
      const table2RecordResult = await request(app.getHttpServer())
        .get(`/api/table/${table2Id}/record`)
        .expect(200);

      expect(table2RecordResult.body.data.records[0].fields[ctx.table2Fields[2].name]).toEqual({
        id: ctx.table1Records[1].id,
      });
      const table1RecordResult2 = await request(app.getHttpServer())
        .get(`/api/table/${table1Id}/record`)
        .expect(200);

      // t1[0](one) should be undefined;
      expect(table1RecordResult2.body.data.records[1].fields[ctx.table1linkField.name]).toEqual([
        {
          id: ctx.table2Records[0].id,
        },
      ]);
      expect(
        table1RecordResult2.body.data.records[0].fields[ctx.table1linkField.name]
      ).toBeUndefined();
    });

    it('should update foreign link field when change lookupField value', async () => {
      // set text for lookup field
      await request(app.getHttpServer())
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.textFieldRo.name]: 'B1',
            },
          },
        } as UpdateRecordRo)
        .expect(200);

      await request(app.getHttpServer())
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[1].id}`)
        .send({
          record: {
            fields: {
              [ctx.textFieldRo.name]: 'B2',
            },
          },
        } as UpdateRecordRo)
        .expect(200);

      // add an extra link for table1 record1
      await request(app.getHttpServer())
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[1].id}`)
        .send({
          record: {
            fields: {
              [ctx.table2LinkFieldRo.name]: { title: 'test', id: ctx.table1Records[0].id },
            },
          },
        } as UpdateRecordRo)
        .expect(200);

      const table1RecordResult2 = await request(app.getHttpServer())
        .get(`/api/table/${table1Id}/record`)
        .expect(200);

      expect(table1RecordResult2.body.data.records[0].fields[ctx.table1linkField.name]).toEqual([
        {
          title: 'B1',
          id: ctx.table2Records[0].id,
        },
        {
          title: 'B2',
          id: ctx.table2Records[1].id,
        },
      ]);

      await request(app.getHttpServer())
        .put(`/api/table/${table1Id}/record/${ctx.table1Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.textFieldRo.name]: 'AX',
            },
          },
        } as UpdateRecordRo)
        .expect(200);

      const table2RecordResult2 = await request(app.getHttpServer())
        .get(`/api/table/${table2Id}/record`)
        .expect(200);

      expect(table2RecordResult2.body.data.records[0].fields[ctx.table2LinkFieldRo.name]).toEqual({
        title: 'AX',
        id: ctx.table1Records[0].id,
      });
    });

    it('should update self foreign link with correct title', async () => {
      // set text for lookup field
      await request(app.getHttpServer())
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.textFieldRo.name]: 'B1',
            },
          },
        } as UpdateRecordRo)
        .expect(200);

      await request(app.getHttpServer())
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[1].id}`)
        .send({
          record: {
            fields: {
              [ctx.textFieldRo.name]: 'B2',
            },
          },
        } as UpdateRecordRo)
        .expect(200);

      await request(app.getHttpServer())
        .put(`/api/table/${table1Id}/record/${ctx.table1Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.table1linkField.name]: [
                { title: 'B1', id: ctx.table2Records[0].id },
                { title: 'B2', id: ctx.table2Records[1].id },
              ],
            },
          },
        } as UpdateRecordRo)
        .expect(200);

      const table1RecordResult2 = await request(app.getHttpServer())
        .get(`/api/table/${table1Id}/record`)
        .expect(200);

      expect(table1RecordResult2.body.data.records[0].fields[ctx.table1linkField.name]).toEqual([
        {
          title: 'B1',
          id: ctx.table2Records[0].id,
        },
        {
          title: 'B2',
          id: ctx.table2Records[1].id,
        },
      ]);
    });

    it('should update formula field when change manyOne link cell', async () => {
      const table2FormulaFieldRo: CreateFieldRo = {
        name: 'table2Formula',
        type: FieldType.Formula,
        options: {
          expression: `{${ctx.table2Fields[2].id}}`,
        },
      };

      await request(app.getHttpServer())
        .post(`/api/table/${table2Id}/field`)
        .send(table2FormulaFieldRo as CreateFieldRo)
        .expect(201);
      await request(app.getHttpServer())
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.table2LinkFieldRo.name]: { title: 'test1', id: ctx.table1Records[1].id },
            },
          },
        } as UpdateRecordRo)
        .expect(200);

      const table1RecordResult = await request(app.getHttpServer())
        .get(`/api/table/${table1Id}/record`)
        .expect(200);

      const table2RecordResult = await request(app.getHttpServer())
        .get(`/api/table/${table2Id}/record`)
        .expect(200);

      expect(
        table1RecordResult.body.data.records[0].fields[ctx.table1linkField.name]
      ).toBeUndefined();

      expect(table1RecordResult.body.data.records[1].fields[ctx.table1linkField.name]).toEqual([
        {
          id: ctx.table2Records[0].id,
        },
      ]);

      expect(table2RecordResult.body.data.records[0].fields[table2FormulaFieldRo.name]).toEqual('');
    });

    it('should update formula field when change oneMany link cell', async () => {
      const table1FormulaFieldRo: CreateFieldRo = {
        name: 'table1 formula field',
        type: FieldType.Formula,
        options: {
          expression: `{${ctx.table1linkField.id}}`,
        },
      };

      await request(app.getHttpServer())
        .post(`/api/table/${table1Id}/field`)
        .send(table1FormulaFieldRo as CreateFieldRo)
        .expect(201);

      await request(app.getHttpServer())
        .put(`/api/table/${table1Id}/record/${ctx.table1Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.table1linkField.name]: [
                { title: 'test1', id: ctx.table2Records[0].id },
                { title: 'test2', id: ctx.table2Records[1].id },
              ],
            },
          },
        } as UpdateRecordRo)
        .expect(200);

      const table1RecordResult = await request(app.getHttpServer())
        .get(`/api/table/${table1Id}/record`)
        .expect(200);

      expect(table1RecordResult.body.data.records[0].fields[ctx.table1linkField.name]).toEqual([
        { id: ctx.table2Records[0].id },
        { id: ctx.table2Records[1].id },
      ]);

      expect(table1RecordResult.body.data.records[0].fields[table1FormulaFieldRo.name]).toEqual(
        ', '
      );
    });
  });
});
