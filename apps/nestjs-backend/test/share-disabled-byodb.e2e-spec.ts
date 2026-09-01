import type { INestApplication } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  createBase,
  enableShareView as apiEnableShareView,
  SHARE_VIEW_GET,
  urlBuilder,
} from '@teable/openapi';
import type { ShareViewGetVo } from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { encryptDataDbUrl } from '../src/features/space/data-db-url-secret';
import { createAnonymousUserAxios } from './utils/axios-instance/anonymous-user';
import { getError } from './utils/get-error';
import { createSpace, createTable, initApp } from './utils/init-app';

describe('Share view on a disabled BYODB binding (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let anonymousUser: AxiosInstance;
  let previousForceV2All: string | undefined;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    const appCtx = await initApp();
    app = appCtx.app;
    prismaService = app.get(PrismaService);
    anonymousUser = createAnonymousUserAxios(appCtx.appUrl);
  });

  afterAll(async () => {
    if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
    else process.env.FORCE_V2_ALL = previousForceV2All;
    await app.close();
  });

  it('returns 503 when the shared space data-db binding is not ready', async () => {
    const space = await createSpace({ name: 'share-disabled-byodb' });
    const isolatedBaseId = await createBase({
      name: 'share-disabled-byodb',
      spaceId: space.id,
    }).then((res) => res.data.id);
    const table = await createTable(isolatedBaseId, { name: 'shared' });
    const isolatedShareId = (
      await apiEnableShareView({ tableId: table.id, viewId: table.defaultViewId! })
    ).data.shareId;
    const connection = await prismaService.dataDbConnection.create({
      data: {
        encryptedUrl: encryptDataDbUrl('postgresql://teable:secret@127.0.0.1:1/disabled'),
        urlFingerprint: `disabled-share-e2e-${Date.now()}`,
        internalSchema: '__teable_internal',
        status: 'disabled',
        createdBy: 'e2e',
      },
    });
    await prismaService.spaceDataDbBinding.create({
      data: {
        spaceId: space.id,
        dataDbConnectionId: connection.id,
        mode: 'byodb',
        state: 'ready',
        createdBy: 'e2e',
      },
    });

    try {
      const error = await getError(() =>
        anonymousUser.get<ShareViewGetVo>(urlBuilder(SHARE_VIEW_GET, { shareId: isolatedShareId }))
      );
      expect(error?.status).toEqual(503);
      expect(error?.code).toEqual(HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE);
    } finally {
      await prismaService.spaceDataDbBinding.deleteMany({ where: { spaceId: space.id } });
      await prismaService.dataDbConnection.deleteMany({ where: { id: connection.id } });
    }
  });
});
