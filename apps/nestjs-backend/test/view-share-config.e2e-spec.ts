import type { INestApplication } from '@nestjs/common';
import { IdPrefix, Role, ViewType } from '@teable/core';
import type { IViewVo } from '@teable/core';
import {
  createBase,
  emailBaseInvitation,
  enableShareView,
  GET_VIEW_LIST,
  getViewList,
  refreshViewShareId,
  updateViewShareMeta,
  urlBuilder,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import type { Connection, Doc } from 'sharedb/lib/client';
import { ShareDbService } from '../src/share-db/share-db.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { createTable, getCookie, initApp, permanentDeleteBase } from './utils/init-app';

const viewerEmail = 'view-share-config-viewer@e2e.com';
const viewerPassword = '12345678a';

// A view's share link opens the view to anyone who holds it, and its settings say how. Only
// members who manage the view's share (`view|share`) receive them; a Viewer reads that the view
// is shared, nothing more.
describe('View share link and settings (e2e)', () => {
  let app: INestApplication;
  let shareDbService: ShareDbService;
  let ownerCookie: string;
  let viewerCookie: string;
  let viewer: AxiosInstance;
  let baseId: string;
  let tableId: string;
  let viewId: string;

  const connect = (cookie: string): Connection =>
    shareDbService.connect(undefined, {
      url: `ws://localhost:${process.env.PORT}/socket`,
      headers: { cookie },
    });
  const subscribe = (connection: Connection) =>
    new Promise<Doc<IViewVo>>((resolve, reject) => {
      const doc = connection.get(`${IdPrefix.View}_${tableId}`, viewId) as Doc<IViewVo>;
      doc.subscribe((error) => (error ? reject(error) : resolve(doc)));
    });
  const waitFor = async (check: () => boolean, timeout = 5000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > timeout) throw new Error('timed out waiting for the view op');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    ownerCookie = appCtx.cookie;
    shareDbService = app.get(ShareDbService);
    baseId = (
      await createBase({ name: 'view-share-config', spaceId: globalThis.testConfig.spaceId })
    ).data.id;
    const table = await createTable(baseId, {
      name: 'shared view table',
      views: [{ type: ViewType.Grid, name: 'Grid' }],
    });
    tableId = table.id;
    viewId = table.defaultViewId!;
    viewer = await createNewUserAxios({ email: viewerEmail, password: viewerPassword });
    await emailBaseInvitation({
      baseId,
      emailBaseInvitationRo: { emails: [viewerEmail], role: Role.Viewer },
    });
    viewerCookie = (await getCookie(viewerEmail, viewerPassword)).cookie.join(';');
    await enableShareView({ tableId, viewId });
    await updateViewShareMeta(tableId, viewId, { password: 'secret-pass' });
  });

  afterAll(async () => {
    await permanentDeleteBase(baseId);
    await app.close();
  });

  it('hands a Viewer only whether the view is shared over REST', async () => {
    const ownerView = (await getViewList(tableId)).data.find((view) => view.id === viewId)!;
    expect(ownerView.shareId).toBeTruthy();
    expect(ownerView.shareMeta?.password).toBe('secret-pass');

    const viewerView = (
      await viewer.get<IViewVo[]>(urlBuilder(GET_VIEW_LIST, { tableId }))
    ).data.find((view) => view.id === viewId)!;
    expect(viewerView.enableShare).toBe(true);
    expect(viewerView).not.toHaveProperty('shareId');
    expect(viewerView).not.toHaveProperty('shareMeta');

    const [snapshot] = (
      await viewer.get<{ data: IViewVo }[]>(`/table/${tableId}/view/socket/snapshot-bulk`, {
        params: { ids: [viewId] },
      })
    ).data;
    expect(snapshot.data.enableShare).toBe(true);
    expect(snapshot.data).not.toHaveProperty('shareId');
    expect(snapshot.data).not.toHaveProperty('shareMeta');
  });

  it('sends a refreshed link and changed settings live to the owner and not to a Viewer', async () => {
    const ownerConnection = connect(ownerCookie);
    const viewerConnection = connect(viewerCookie);
    try {
      const [ownerDoc, viewerDoc] = await Promise.all([
        subscribe(ownerConnection),
        subscribe(viewerConnection),
      ]);
      expect(viewerDoc.data.shareId).toBeUndefined();
      expect(viewerDoc.data.shareMeta).toBeUndefined();
      const viewerOps: unknown[] = [];
      viewerDoc.on('op', (ops) => viewerOps.push(ops));

      const { shareId } = (await refreshViewShareId(tableId, viewId)).data;
      await waitFor(() => ownerDoc.data.shareId === shareId);
      await waitFor(() => viewerOps.length > 0);

      await updateViewShareMeta(tableId, viewId, { password: 'secret-pass', allowCopy: true });
      await waitFor(() => Boolean(ownerDoc.data.shareMeta?.allowCopy));
      await waitFor(() => viewerOps.length > 1);

      expect(viewerDoc.data.shareId).toBeUndefined();
      expect(viewerDoc.data.shareMeta).toBeUndefined();
      expect(JSON.stringify(viewerOps)).not.toContain(shareId);
      expect(JSON.stringify(viewerOps)).not.toContain('allowCopy');
    } finally {
      ownerConnection.close();
      viewerConnection.close();
    }
  });
});
