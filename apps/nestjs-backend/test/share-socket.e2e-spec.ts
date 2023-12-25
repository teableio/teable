/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { IdPrefix, ViewType } from '@teable-group/core';
import type { ICreateTableRo, ITableFullVo } from '@teable-group/core';
import { map } from 'lodash';
import { logger, type Doc } from 'sharedb/lib/client';
import type request from 'supertest';
import { vi } from 'vitest';
import { ShareDbService } from '../src/share-db/share-db.service';
import { initApp, updateViewColumnMeta } from './utils/init-app';

describe('Share (socket-e2e) (e2e)', () => {
  let app: INestApplication;
  let tableId: string;
  let shareId: string;
  let viewId: string;
  let request: request.SuperAgentTest;
  const baseId = globalThis.testConfig.baseId;
  let fieldIds: string[] = [];
  let shareDbService!: ShareDbService;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    shareDbService = app.get(ShareDbService);
    request = appCtx.request;
    const result = await request
      .post(`/api/base/${baseId}/table`)
      .send({
        name: 'table1',
        views: [
          {
            type: ViewType.Grid,
            name: 'view1',
          },
          {
            type: ViewType.Form,
            name: 'view2',
          },
        ],
      } as ICreateTableRo)
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
    await updateViewColumnMeta(tableId, viewId, [
      { fieldId: field.id, columnMeta: { hidden: true } },
    ]);
    shareId = shareResult.body.shareId;
  });

  afterAll(async () => {
    await request.delete(`/api/base/${baseId}/table/arbitrary/${tableId}`).expect(200);
    await app.close();
  });

  const getQuery = (collection: string, shareId: string) => {
    return new Promise<Doc<any>[]>((resolve, reject) => {
      const connection = shareDbService.connect(undefined, {
        url: `ws://localhost:3000/socket?shareId=${shareId}`,
        headers: {},
      });
      connection.createFetchQuery(collection, {}, {}, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
      connection.on('error', (err) => reject(err));
      connection.agent?.stream.on('error', (err) => reject(err));
      shareDbService.on('error', (err) => reject(err));
      setTimeout(() => {
        reject(new Error('connection error'));
      }, 2000);
    });
  };

  it('Retrieve fields other than those that are hidden', async () => {
    const collection = `${IdPrefix.Field}_${tableId}`;
    const fields = await getQuery(collection, shareId);
    expect(fields.length).toEqual(fieldIds.length - 1);
  });

  it('Reading the view query will only get the one that was shared', async () => {
    const collection = `${IdPrefix.View}_${tableId}`;
    const views = await getQuery(collection, shareId);

    expect(views.length).toEqual(1);
    expect(views[0].id).toEqual(viewId);
  });

  it('shareId error', async () => {
    const collection = `${IdPrefix.View}_${tableId}`;
    const consoleWarnSpy = vi.spyOn(logger, 'warn');
    await expect(getQuery(collection, 'share')).rejects.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Agent closed due to error',
      expect.anything(),
      expect.objectContaining({
        message: 'Unauthorized',
        code: 'unauthorized_share',
      })
    );
  });
});
