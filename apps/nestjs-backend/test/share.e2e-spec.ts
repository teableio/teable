import type { INestApplication } from '@nestjs/common';
import { ANONYMOUS_USER_ID, ViewType } from '@teable-group/core';
import type { ITableFullVo, IViewRo } from '@teable-group/core';
import type { ShareViewFormSubmitVo, ShareViewGetVo } from '@teable-group/openapi';
import { map } from 'lodash';
import type request from 'supertest';
import innerRequest from 'supertest';
import { initApp, updateField } from './utils/init-app';

describe('OpenAPI ShareController (e2e)', () => {
  let app: INestApplication;
  let tableId: string;
  let shareId: string;
  let viewId: string;
  let request: request.SuperAgentTest;
  let anonymousRequest: request.SuperAgentTest;
  const baseId = globalThis.testConfig.baseId;
  let fieldIds: string[] = [];

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;
    anonymousRequest = innerRequest.agent(app.getHttpServer());
    const result = await request
      .post(`/api/base/${baseId}/table`)
      .send({
        name: 'table1',
      })
      .expect(201);
    const table = result.body as ITableFullVo;
    tableId = table.id;
    viewId = table.defaultViewId!;
    const shareResult = await request
      .patch(`/api/table/${tableId}/view/${viewId}/enableShare`)
      .expect(200);
    fieldIds = map(table.fields, 'id');
    // hidden last one field
    const field = table.fields[fieldIds.length - 1];
    await updateField(tableId, field.id, {
      columnMeta: { [viewId]: { ...field.columnMeta[viewId], hidden: true } },
      type: field.type,
    });
    shareId = shareResult.body.shareId;
  });

  afterAll(async () => {
    await request.delete(`/api/base/${baseId}/table/arbitrary/${tableId}`).expect(200);
    await app.close();
  });

  it('getShareView', async () => {
    const result = await anonymousRequest.get(`/api/share/${shareId}/view`).expect(200);
    const shareViewData = result.body as ShareViewGetVo;
    // filter hidden field
    expect(shareViewData.fields.length).toEqual(fieldIds.length - 1);
    expect(shareViewData.viewId).toEqual(viewId);
  });

  describe('Share from view', () => {
    let formViewId: string;
    let fromViewShareId: string;
    beforeEach(async () => {
      const viewRo: IViewRo = {
        name: 'Form view',
        description: 'the form view',
        type: ViewType.Form,
      };
      const result = await request.post(`/api/table/${tableId}/view`).send(viewRo).expect(201);
      formViewId = result.body.id;
      const shareResult = await request
        .patch(`/api/table/${tableId}/view/${formViewId}/enableShare`)
        .expect(200);
      fromViewShareId = shareResult.body.shareId;
    });

    it('submit form view', async () => {
      const result = await anonymousRequest
        .post(`/api/share/${fromViewShareId}/view/formSubmit`)
        .send({ fields: {} })
        .expect(201);
      const record = result.body as ShareViewFormSubmitVo;
      expect(record.createdBy).toEqual(ANONYMOUS_USER_ID);
    });
  });
});
