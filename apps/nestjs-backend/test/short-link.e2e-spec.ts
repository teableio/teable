import type { INestApplication } from '@nestjs/common';
import { ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  createBase,
  createBaseShare,
  createView,
  createShortLink,
  deleteView,
  disableShareView,
  enableShareView,
  getBaseNodeList,
  getShortLink,
  GET_SHORT_LINK,
  ShortLinkType,
  updateBaseShare,
  urlBuilder,
} from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import { createAnonymousUserAxios } from './utils/axios-instance/anonymous-user';
import { getError } from './utils/get-error';
import { createTable, initApp, permanentDeleteBase, permanentDeleteTable } from './utils/init-app';

describe('OpenAPI ShortLinkController (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  let shareId: string;
  let prisma: PrismaService;
  let anonymousUser: ReturnType<typeof createAnonymousUserAxios>;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
    anonymousUser = createAnonymousUserAxios(appCtx.appUrl);

    table = await createTable(baseId, { name: 'short-link-table' });
    const shareResult = await enableShareView({
      tableId: table.id,
      viewId: table.defaultViewId!,
    });
    shareId = shareResult.data.shareId;
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
    await app.close();
  });

  it('should create a short link for a share view and resolve it anonymously', async () => {
    const { data: created } = await createShortLink({
      type: ShortLinkType.ViewShare,
      resourceId: shareId,
    });
    expect(created.code).toHaveLength(9);
    expect(created.path).toBe(`/share/${shareId}/view`);

    // resolve is public
    const { data: resolved } = await anonymousUser.get(
      urlBuilder(GET_SHORT_LINK, { code: created.code })
    );
    expect(resolved.path).toBe(`/share/${shareId}/view`);
  });

  it('should reuse the same code for the same resource', async () => {
    const { data: first } = await createShortLink({
      type: ShortLinkType.ViewShare,
      resourceId: shareId,
    });
    const { data: second } = await createShortLink({
      type: ShortLinkType.ViewShare,
      resourceId: shareId,
    });
    expect(second.code).toBe(first.code);
  });

  it('should reject creating a short link for a non-existent share', async () => {
    const error = await getError(() =>
      createShortLink({
        type: ShortLinkType.ViewShare,
        resourceId: 'shrnotexist12345',
      })
    );
    expect(error?.status).toBe(404);
  });

  it('should return 404 for an unknown code', async () => {
    const error = await getError(() => getShortLink('notacode'));
    expect(error?.status).toBe(404);
  });

  it('should stop resolving after the share is disabled', async () => {
    // use a dedicated share whose short link has never been resolved,
    // so the resolve cache cannot mask the revocation
    const table2 = await createTable(baseId, { name: 'short-link-table-2' });
    const share2 = await enableShareView({
      tableId: table2.id,
      viewId: table2.defaultViewId!,
    });
    const { data: created } = await createShortLink({
      type: ShortLinkType.ViewShare,
      resourceId: share2.data.shareId,
    });

    await disableShareView({ tableId: table2.id, viewId: table2.defaultViewId! });

    const error = await getError(() => getShortLink(created.code));
    expect(error?.status).toBe(404);

    // re-enabling generates a new shareId, so the old short link stays dead
    // and a new short link is created for the new shareId
    const reEnabled = await enableShareView({
      tableId: table2.id,
      viewId: table2.defaultViewId!,
    });
    const { data: recreated } = await createShortLink({
      type: ShortLinkType.ViewShare,
      resourceId: reEnabled.data.shareId,
    });
    expect(recreated.code).not.toBe(created.code);
    expect(recreated.path).toBe(`/share/${reEnabled.data.shareId}/view`);

    // the rotated-away short link is marked deleted and stays dead
    const errorAfterRotate = await getError(() => getShortLink(created.code));
    expect(errorAfterRotate?.status).toBe(404);

    await permanentDeleteTable(baseId, table2.id);
  });

  describe('base share short links', () => {
    let shareBaseId: string;
    let firstTable: ITableFullVo;
    let secondTable: ITableFullVo;
    let firstTableNodeId: string;
    let secondTableNodeId: string;

    beforeAll(async () => {
      const base = await createBase({
        name: 'short-link-base-share',
        spaceId: globalThis.testConfig.spaceId,
      }).then((res) => res.data);
      shareBaseId = base.id;
      firstTable = await createTable(shareBaseId, { name: 'short-link-share-table' });
      secondTable = await createTable(shareBaseId, { name: 'short-link-share-table-2' });

      const nodeList = await getBaseNodeList(shareBaseId);
      const firstTableNode = nodeList.data.find((node) => node.resourceId === firstTable.id);
      const secondTableNode = nodeList.data.find((node) => node.resourceId === secondTable.id);
      if (!firstTableNode || !secondTableNode) {
        throw new Error('Table nodes not found in base node list');
      }
      firstTableNodeId = firstTableNode.id;
      secondTableNodeId = secondTableNode.id;
    });

    afterAll(async () => {
      await permanentDeleteBase(shareBaseId);
    });

    it('should resolve straight to the final table view page in a single redirect', async () => {
      const share = await createBaseShare(shareBaseId, { nodeId: firstTableNodeId });
      const shareId = share.data.shareId;

      const { data: created } = await createShortLink({
        type: ShortLinkType.BaseShare,
        resourceId: shareId,
      });
      const expectedPath = `/share/${shareId}/base/${shareBaseId}/table/${firstTable.id}/${firstTable.defaultViewId}`;
      expect(created.path).toBe(expectedPath);

      // resolve is public
      const { data: resolved } = await anonymousUser.get(
        urlBuilder(GET_SHORT_LINK, { code: created.code })
      );
      expect(resolved.path).toBe(expectedPath);
    });

    it('should keep the shallow path for a password-protected base share', async () => {
      const share = await createBaseShare(shareBaseId, { nodeId: secondTableNodeId });
      const shareId = share.data.shareId;
      await updateBaseShare(shareBaseId, shareId, { password: 'secret123' });

      // The deep target ids must not be exposed before the share password is entered
      const { data: created } = await createShortLink({
        type: ShortLinkType.BaseShare,
        resourceId: shareId,
      });
      expect(created.path).toBe(`/share/${shareId}/base`);
    });
  });

  it('should stop resolving a retained short link after its shared View is deleted', async () => {
    const view = (
      await createView(table.id, {
        type: ViewType.Grid,
        name: 'deleted-share-view',
      })
    ).data;
    const enabled = await enableShareView({ tableId: table.id, viewId: view.id });
    const { data: created } = await createShortLink({
      type: ShortLinkType.ViewShare,
      resourceId: enabled.data.shareId,
    });

    // Do not resolve before deletion: the short-link cache is intentionally
    // short-lived and this case verifies the authoritative database lookup.
    await deleteView(table.id, view.id);

    expect(
      await prisma.shortLink.findUnique({
        where: { code: created.code },
        select: { type: true, resourceId: true, deletedTime: true },
      })
    ).toEqual({
      type: ShortLinkType.ViewShare,
      resourceId: enabled.data.shareId,
      deletedTime: null,
    });
    const error = await getError(() => getShortLink(created.code));
    expect(error?.status).toBe(404);
  });
});
