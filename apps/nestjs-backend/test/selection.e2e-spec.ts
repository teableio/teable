/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { ITableFullVo } from '@teable-group/core';
import type { IRangesToIdVo } from '@teable-group/openapi';
import { RangeType, IdReturnType } from '@teable-group/openapi';
import type request from 'supertest';
import { initApp } from './utils/init-app';

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
});
