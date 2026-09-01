import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, IdPrefix, SortFunc, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { manualSortView } from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import type { Connection, Query } from 'sharedb/lib/client';
import { ShareDbService } from '../src/share-db/share-db.service';
import { createTable, getRecords, initApp, permanentDeleteTable } from './utils/init-app';
import { waitFor } from './utils/wait';

const waitForQueryReady = (query: Query<unknown>, timeout = 5000): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (query.ready) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error('Query ready timeout')), timeout);
    query.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });
};

// Manual sort materializes __row_<viewId> in one bulk v2 record write. The
// ViewManualSortApplied projection must invalidate collection queries after
// commit, while the native record repository rotates table lastModifiedTime.
describe('OpenAPI ViewController manual-sort realtime (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let port: string;
  let shareDbService: ShareDbService;
  let prismaService: PrismaService;
  let table: ITableFullVo;
  let viewId: string;
  let numberFieldId: string;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    cookie = appCtx.cookie;
    port = process.env.PORT!;
    shareDbService = app.get(ShareDbService);
    prismaService = app.get(PrismaService);

    table = await createTable(baseId, {
      name: 'manual-sort-realtime',
      views: [{ type: ViewType.Grid, name: 'default-view' }],
      fields: [
        { name: 'title', type: FieldType.SingleLineText },
        { name: 'num', type: FieldType.Number },
      ],
      records: [{ fields: { num: 3 } }, { fields: { num: 1 } }, { fields: { num: 2 } }],
    });
    viewId = table.defaultViewId!;
    numberFieldId = table.fields.find((field) => field.type === FieldType.Number)!.id;
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
    await app.close();
  });

  it('bumps table lastModifiedTime so the socket doc-ids cache key rotates', async () => {
    const before = await prismaService.tableMeta.findUniqueOrThrow({
      where: { id: table.id },
      select: { lastModifiedTime: true },
    });

    await manualSortView(table.id, viewId, {
      sortObjs: [{ fieldId: numberFieldId, order: SortFunc.Asc }],
    });

    const after = await prismaService.tableMeta.findUniqueOrThrow({
      where: { id: table.id },
      select: { lastModifiedTime: true },
    });

    expect(after.lastModifiedTime).not.toBeNull();
    expect(after.lastModifiedTime!.getTime()).toBeGreaterThan(
      before.lastModifiedTime?.getTime() ?? 0
    );
  });

  it('re-polls live record subscriptions and pushes the new order', async () => {
    const connection: Connection = shareDbService.connect(undefined, {
      url: `ws://localhost:${port}/socket`,
      headers: { cookie },
    });
    const collection = `${IdPrefix.Record}_${table.id}`;
    // same shape the app subscribes with: the viewId rides along for the
    // view's manual row order, so this query's result order follows
    // __row_<viewId>
    const query = connection.createSubscribeQuery(collection, {
      viewId,
      type: IdPrefix.Record,
    });

    try {
      await waitForQueryReady(query);

      await manualSortView(table.id, viewId, {
        sortObjs: [{ fieldId: numberFieldId, order: SortFunc.Desc }],
      });

      const expectedIds = [table.records[0].id, table.records[2].id, table.records[1].id];
      await waitFor(() => query.results.map((doc) => doc.id).join() === expectedIds.join(), 8000);

      // socket order must match what a fresh REST read (SSR) returns
      const restRecords = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId,
      });
      expect(restRecords.records.map((record) => record.id)).toEqual(expectedIds);
    } finally {
      query.destroy();
      connection.close();
    }
  });
});
