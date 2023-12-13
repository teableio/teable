/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type {
  ITableFullVo,
  IFieldRo,
  IRecordsVo,
  IGetRecordsQuery,
  IFieldVo,
  IRowCountVo,
} from '@teable-group/core';
import { FieldKeyType, FieldType, NumberFormattingType, Relationship } from '@teable-group/core';
import qs from 'qs';
import type request from 'supertest';
import { getFields, initApp, createField, updateRecordByApi } from './utils/init-app';

describe('OpenAPI link Select (e2e)', () => {
  let app: INestApplication;
  jest.useRealTimers();
  let request: request.SuperAgentTest;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('get records filter by link field Id', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      const createTable1Result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table1',
          fields: [textFieldRo, numberFieldRo],
          records: [
            { fields: { 'text field': 'table1_1' } },
            { fields: { 'text field': 'table1_2' } },
            { fields: { 'text field': 'table1_3' } },
          ],
        })
        .expect(201);

      table1 = createTable1Result.body;

      const createTable2Result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table2',
          fields: [textFieldRo, numberFieldRo],
          records: [
            { fields: { 'text field': 'table2_1' } },
            { fields: { 'text field': 'table2_2' } },
            { fields: { 'text field': 'table2_3' } },
          ],
        })
        .expect(201);

      table2 = createTable2Result.body;

      const getFields1Result = await request.get(`/api/table/${table1.id}/field`).expect(200);
      const getFields2Result = await request.get(`/api/table/${table2.id}/field`).expect(200);

      table1.fields = getFields1Result.body;
      table2.fields = getFields2Result.body;
    });

    afterEach(async () => {
      await request.delete(`/api/base/${baseId}/table/arbitrary/${table1.id}`);
      await request.delete(`/api/base/${baseId}/table/arbitrary/${table2.id}`);
    });

    describe.each([
      {
        relationship: Relationship.OneMany,
        reversRelationship: Relationship.ManyOne,
        result: [
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
          { left: { c: 3, s: 0 }, right: { c: 2, s: 0 } },
        ],
        direction: 'two way',
        isOneWay: undefined,
      },
      {
        relationship: Relationship.OneMany,
        reversRelationship: Relationship.ManyOne,
        result: [
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
          { left: { c: 3, s: 0 }, right: { c: 2, s: 0 } },
        ],
        direction: 'one Way',
        isOneWay: true,
      },
      {
        relationship: Relationship.OneOne,
        reversRelationship: Relationship.OneOne,
        result: [
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
          { left: { c: 2, s: 0 }, right: { c: 2, s: 0 } },
        ],
        direction: 'two way',
        isOneWay: undefined,
      },
      {
        relationship: Relationship.OneOne,
        reversRelationship: Relationship.OneOne,
        result: [
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
          { left: { c: 2, s: 0 }, right: { c: 2, s: 0 } },
        ],
        direction: 'one Way',
        isOneWay: true,
      },
      {
        relationship: Relationship.ManyMany,

        reversRelationship: Relationship.ManyMany,
        result: [
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
        ],
        direction: 'two way',
      },
      {
        relationship: Relationship.ManyMany,
        reversRelationship: Relationship.ManyMany,
        result: [
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
        ],
        isOneWay: true,
      },
    ])(
      'fetch candidate records for $relationship, $reversRelationship, $direction field',
      ({ relationship, reversRelationship, isOneWay, result }) => {
        let linkField1: IFieldVo;
        let linkField2: IFieldVo;
        beforeEach(async () => {
          // create link field
          const Link1FieldRo: IFieldRo = {
            name: 'link field',
            type: FieldType.Link,
            options: {
              relationship,
              foreignTableId: table2.id,
              isOneWay,
            },
          };

          linkField1 = await createField(request, table1.id, Link1FieldRo);

          if (isOneWay) {
            // create link field back
            const Link2FieldRo: IFieldRo = {
              name: 'link field',
              type: FieldType.Link,
              options: {
                relationship: reversRelationship,
                foreignTableId: table1.id,
                isOneWay: true,
              },
            };
            linkField2 = await createField(request, table2.id, Link2FieldRo);
          } else {
            const table2Fields = await getFields(request, table2.id);
            linkField2 = table2Fields[2];
          }
        });

        it('should fetch all candidate and selected records', async () => {
          const table1Candidate: IGetRecordsQuery = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellCandidate: [linkField2.id, table2.records[0].id],
          };

          const table1Selected: IGetRecordsQuery = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellSelected: [linkField2.id, table2.records[0].id],
          };

          const table2Candidate: IGetRecordsQuery = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellCandidate: [linkField1.id, table1.records[0].id],
          };

          const table2Selected: IGetRecordsQuery = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellSelected: [linkField1.id, table1.records[0].id],
          };

          const table1CResult = (
            await request
              .get(`/api/table/${table1.id}/record`)
              .query(qs.stringify(table1Candidate))
              .expect(200)
          ).body as IRecordsVo;
          expect(table1CResult.records.length).toBe(result[0].left.c);

          const table1CResultRow = (
            await request
              .get(`/api/base/${baseId}/table/${table1.id}/rowCount`)
              .query(qs.stringify(table1Candidate))
              .expect(200)
          ).body as IRowCountVo;
          expect(table1CResultRow.rowCount).toBe(result[0].left.c);

          const table1SResult = (
            await request
              .get(`/api/table/${table1.id}/record`)
              .query(qs.stringify(table1Selected))
              .expect(200)
          ).body as IRecordsVo;
          expect(table1SResult.records.length).toBe(result[0].left.s);

          const table1SResultRow = (
            await request
              .get(`/api/base/${baseId}/table/${table1.id}/rowCount`)
              .query(qs.stringify(table1Selected))
              .expect(200)
          ).body as IRowCountVo;
          expect(table1SResultRow.rowCount).toBe(result[0].left.s);

          const table2CResult = (
            await request
              .get(`/api/table/${table2.id}/record`)
              .query(qs.stringify(table2Candidate))
              .expect(200)
          ).body as IRecordsVo;
          expect(table2CResult.records.length).toBe(result[0].right.c);

          const table2CResultRow = (
            await request
              .get(`/api/base/${baseId}/table/${table2.id}/rowCount`)
              .query(qs.stringify(table2Candidate))
              .expect(200)
          ).body as IRowCountVo;
          expect(table2CResultRow.rowCount).toBe(result[0].right.c);

          const table2SResult = (
            await request
              .get(`/api/table/${table2.id}/record`)
              .query(qs.stringify(table2Selected))
              .expect(200)
          ).body as IRecordsVo;
          expect(table2SResult.records.length).toBe(result[0].right.s);

          const table2SResultRow = (
            await request
              .get(`/api/base/${baseId}/table/${table2.id}/rowCount`)
              .query(qs.stringify(table2Selected))
              .expect(200)
          ).body as IRowCountVo;
          expect(table2SResultRow.rowCount).toBe(result[0].right.s);
        });

        it('should fetch candidate and selected records after link', async () => {
          const value =
            relationship === Relationship.ManyMany
              ? [{ id: table1.records[0].id }]
              : { id: table1.records[0].id };
          // table2 link field first record link to table1 first record
          await updateRecordByApi(request, table2.id, table2.records[0].id, linkField2.id, value);
          if (isOneWay) {
            // table1 link field first record link to table2 first record
            const value =
              relationship === Relationship.OneOne
                ? { id: table2.records[0].id }
                : [{ id: table2.records[0].id }];
            await updateRecordByApi(request, table1.id, table1.records[0].id, linkField1.id, value);
          }

          const table1Candidate: IGetRecordsQuery = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellCandidate: [linkField2.id, table2.records[0].id],
          };

          const table1Selected: IGetRecordsQuery = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellSelected: [linkField2.id, table2.records[0].id],
          };

          const table2Candidate: IGetRecordsQuery = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellCandidate: [linkField1.id, table1.records[0].id],
          };

          const table2Selected: IGetRecordsQuery = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellSelected: [linkField1.id, table1.records[0].id],
          };

          const table1CResult = (
            await request
              .get(`/api/table/${table1.id}/record`)
              .query(qs.stringify(table1Candidate))
              .expect(200)
          ).body as IRecordsVo;

          expect(table1CResult.records.length).toBe(result[1].left.c);

          const table1SResult = (
            await request
              .get(`/api/table/${table1.id}/record`)
              .query(qs.stringify(table1Selected))
              .expect(200)
          ).body as IRecordsVo;

          expect(table1SResult.records.length).toBe(result[1].left.s);

          const table2CResult = (
            await request
              .get(`/api/table/${table2.id}/record`)
              .query(qs.stringify(table2Candidate))
              .expect(200)
          ).body as IRecordsVo;

          expect(table2CResult.records.length).toBe(result[1].right.c);

          const table2SResult = (
            await request
              .get(`/api/table/${table2.id}/record`)
              .query(qs.stringify(table2Selected))
              .expect(200)
          ).body as IRecordsVo;

          expect(table2SResult.records.length).toBe(result[1].right.s);
        });

        it('should fetch candidate and selected  records after link without recordId', async () => {
          const value =
            relationship === Relationship.ManyMany
              ? [{ id: table1.records[0].id }]
              : { id: table1.records[0].id };
          // table2 link field first record link to table1 first record
          await updateRecordByApi(request, table2.id, table2.records[0].id, linkField2.id, value);
          if (isOneWay) {
            // table1 link field first record link to table2 first record
            const value =
              relationship === Relationship.OneOne
                ? { id: table2.records[0].id }
                : [{ id: table2.records[0].id }];
            await updateRecordByApi(request, table1.id, table1.records[0].id, linkField1.id, value);
          }

          const table1Candidate: IGetRecordsQuery = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellCandidate: linkField2.id,
          };

          const table1Selected: IGetRecordsQuery = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellSelected: linkField2.id,
          };

          const table2Candidate: IGetRecordsQuery = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellCandidate: linkField1.id,
          };

          const table2Selected: IGetRecordsQuery = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellSelected: linkField1.id,
          };

          const table1CResult = (
            await request
              .get(`/api/table/${table1.id}/record`)
              .query(qs.stringify(table1Candidate))
              .expect(200)
          ).body as IRecordsVo;

          expect(table1CResult.records.length).toBe(result[2].left.c);

          const table1SResult = (
            await request
              .get(`/api/table/${table1.id}/record`)
              .query(qs.stringify(table1Selected))
              .expect(200)
          ).body as IRecordsVo;

          expect(table1SResult.records.length).toBe(result[2].left.s);

          const table2CResult = (
            await request
              .get(`/api/table/${table2.id}/record`)
              .query(qs.stringify(table2Candidate))
              .expect(200)
          ).body as IRecordsVo;

          expect(table2CResult.records.length).toBe(result[2].right.c);

          const table2SResult = (
            await request
              .get(`/api/table/${table2.id}/record`)
              .query(qs.stringify(table2Selected))
              .expect(200)
          ).body as IRecordsVo;

          expect(table2SResult.records.length).toBe(result[2].right.s);
        });
      }
    );
  });
});
