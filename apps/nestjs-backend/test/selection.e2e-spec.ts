/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable-group/core';
import type { IFieldRo, ITableFullVo } from '@teable-group/core';
import type { IRangesToIdVo } from '@teable-group/openapi';
import { RangeType, IdReturnType } from '@teable-group/openapi';
import type request from 'supertest';
import { createField, getRecord, initApp } from './utils/init-app';

describe('OpenAPI SelectionController (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  let request: request.SuperAgentTest;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;
  });

  beforeEach(async () => {
    const result = await request
      .post(`/api/base/${baseId}/table`)
      .send({
        name: 'table1',
      })
      .expect(201);
    table = result.body;
  });

  afterEach(async () => {
    const result = await request.delete(`/api/base/${baseId}/table/arbitrary/${table.id}`);
    console.log('clear table: ', result.body);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('getIdsFromRanges', () => {
    it('should return all ids for cell range ', async () => {
      const viewId = table.views[0].id;
      const result = await request
        .get(`/api/table/${table.id}/view/${viewId}/selection/getIdsFromRanges`)
        .query({
          ranges: JSON.stringify([
            [0, 0],
            [0, 0],
          ]),
          returnType: IdReturnType.All,
        });
      const data: IRangesToIdVo = result.body;
      expect(data.recordIds).toHaveLength(1);
      expect(data.fieldIds).toHaveLength(1);
    });

    it('should return all ids for row range', async () => {
      const viewId = table.views[0].id;
      const result = await request
        .get(`/api/table/${table.id}/view/${viewId}/selection/getIdsFromRanges`)
        .query({
          ranges: JSON.stringify([[0, 1]]),
          type: RangeType.Rows,
          returnType: IdReturnType.All,
        });
      const data: IRangesToIdVo = result.body;
      expect(data.recordIds).toHaveLength(2);
      expect(data.fieldIds).toHaveLength(table.fields.length);
    });

    it('should return all ids for column range', async () => {
      const viewId = table.views[0].id;
      const result = await request
        .get(`/api/table/${table.id}/view/${viewId}/selection/getIdsFromRanges`)
        .query({
          ranges: JSON.stringify([[0, 1]]),
          type: RangeType.Columns,
          returnType: IdReturnType.All,
        });
      const data: IRangesToIdVo = result.body;
      expect(data.recordIds).toHaveLength(table.records.length);
      expect(data.fieldIds).toHaveLength(2);
    });

    it('should return record ids for cell range', async () => {
      const viewId = table.views[0].id;
      const result = await request
        .get(`/api/table/${table.id}/view/${viewId}/selection/getIdsFromRanges`)
        .query({
          ranges: JSON.stringify([
            [0, 0],
            [0, 1],
          ]),
          returnType: IdReturnType.RecordId,
        });
      const data: IRangesToIdVo = result.body;
      expect(data.recordIds).toHaveLength(2);
      expect(data.fieldIds).toBeUndefined();
    });

    it('should return record ids for row range', async () => {
      const viewId = table.views[0].id;
      const result = await request
        .get(`/api/table/${table.id}/view/${viewId}/selection/getIdsFromRanges`)
        .query({
          ranges: JSON.stringify([[0, 1]]),
          type: RangeType.Rows,
          returnType: IdReturnType.RecordId,
        });
      const data: IRangesToIdVo = result.body;
      expect(data.recordIds).toHaveLength(2);
      expect(data.fieldIds).toBeUndefined();
    });

    it('should return record ids for column range', async () => {
      const viewId = table.views[0].id;
      const result = await request
        .get(`/api/table/${table.id}/view/${viewId}/selection/getIdsFromRanges`)
        .query({
          ranges: JSON.stringify([[0, 0]]),
          type: RangeType.Columns,
          returnType: IdReturnType.RecordId,
        });
      const data: IRangesToIdVo = result.body;
      expect(data.recordIds).toHaveLength(table.records.length);
      expect(data.fieldIds).toBeUndefined();
    });

    it('should return field ids for cell range', async () => {
      const viewId = table.views[0].id;
      const result = await request
        .get(`/api/table/${table.id}/view/${viewId}/selection/getIdsFromRanges`)
        .query({
          ranges: JSON.stringify([
            [0, 0],
            [0, 1],
          ]),
          returnType: IdReturnType.FieldId,
        });
      const data: IRangesToIdVo = result.body;
      expect(data.fieldIds).toHaveLength(1);
      expect(data.recordIds).toBeUndefined();
    });

    it('should return field ids for row range', async () => {
      const viewId = table.views[0].id;
      const result = await request
        .get(`/api/table/${table.id}/view/${viewId}/selection/getIdsFromRanges`)
        .query({
          ranges: JSON.stringify([[0, 1]]),
          type: RangeType.Rows,
          returnType: IdReturnType.FieldId,
        });
      const data: IRangesToIdVo = result.body;
      expect(data.fieldIds).toHaveLength(table.fields.length);
      expect(data.recordIds).toBeUndefined();
    });

    it('should return record ids for column range', async () => {
      const viewId = table.views[0].id;
      const result = await request
        .get(`/api/table/${table.id}/view/${viewId}/selection/getIdsFromRanges`)
        .query({
          ranges: JSON.stringify([[0, 0]]),
          type: RangeType.Columns,
          returnType: IdReturnType.FieldId,
        });
      const data: IRangesToIdVo = result.body;
      expect(data.fieldIds).toHaveLength(1);
      expect(data.recordIds).toBeUndefined();
    });
  });

  describe('past link records', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const createTable1Result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table1',
          fields: [textFieldRo],
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
          fields: [textFieldRo],
          records: [
            { fields: { 'text field': 'table2_1' } },
            { fields: { 'text field': 'table2_2' } },
            { fields: { 'text field': 'table2_3' } },
          ],
        })
        .expect(201);

      table2 = createTable2Result.body;
    });

    afterEach(async () => {
      await request.delete(`/api/base/${baseId}/table/arbitrary/${table1.id}`);
      await request.delete(`/api/base/${baseId}/table/arbitrary/${table2.id}`);
    });

    it('should paste 2 manyOne link field in same time', async () => {
      // create link field
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const linkField1 = await createField(request, table1.id, table1LinkFieldRo);
      const linkField2 = await createField(request, table1.id, table1LinkFieldRo);
      await request
        .patch(`/api/table/${table1.id}/view/${table1.views[0].id}/selection/paste`)
        .send({
          content: 'table2_1\ttable2_2',
          cell: [1, 0],
          header: [linkField1, linkField2],
        })
        .expect(200);

      const record = await getRecord(request, table1.id, table1.records[0].id);

      console.log(record.fields);

      expect(record.fields[linkField1.id]).toEqual({
        id: table2.records[0].id,
        title: 'table2_1',
      });

      expect(record.fields[linkField2.id]).toEqual({
        id: table2.records[1].id,
        title: 'table2_2',
      });
    });

    it('should paste 2 oneMany link field in same time', async () => {
      // create link field
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      const linkField1 = await createField(request, table1.id, table1LinkFieldRo);
      const linkField2 = await createField(request, table1.id, table1LinkFieldRo);
      await request
        .patch(`/api/table/${table1.id}/view/${table1.views[0].id}/selection/paste`)
        .send({
          content: 'table2_1\ttable2_2',
          cell: [1, 0],
          header: [linkField1, linkField2],
        })
        .expect(200);

      const record = await getRecord(request, table1.id, table1.records[0].id);

      expect(record.fields[linkField1.id]).toEqual([
        {
          id: table2.records[0].id,
          title: 'table2_1',
        },
      ]);

      expect(record.fields[linkField2.id]).toEqual([
        {
          id: table2.records[1].id,
          title: 'table2_2',
        },
      ]);
    });
  });
});
