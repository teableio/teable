/* eslint-disable @typescript-eslint/no-explicit-any */
import type { JwtService } from '@nestjs/jwt';
import { HttpErrorCode } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { PluginPosition, pluginGetTokenRoSchema, type IPluginGetTokenRo } from '@teable/openapi';
import type { ClsService } from 'nestjs-cls';
import type { CacheService } from '../../cache/cache.service';
import type { IClsStore } from '../../types/cls';
import type { AccessTokenService } from '../access-token/access-token.service';
import { PluginAuthService } from './plugin-auth.service';

describe('PluginAuthService', () => {
  const pluginInstallFindMany = vitest.fn();
  const dashboardFindFirst = vitest.fn();
  const viewFindFirst = vitest.fn();
  const pluginPanelFindFirst = vitest.fn();
  const pluginContextMenuFindFirst = vitest.fn();
  const findAccessToken = vitest.fn();
  const deleteAccessToken = vitest.fn();
  const getAuthCode = vitest.fn();
  const deleteAuthCode = vitest.fn();
  const setAuthCode = vitest.fn();
  const verifyRefreshToken = vitest.fn();
  const getCls = vitest.fn();
  const transactionClient = {
    accessToken: {
      findFirstOrThrow: findAccessToken,
      delete: deleteAccessToken,
    },
    pluginInstall: { findMany: pluginInstallFindMany },
    dashboard: { findFirst: dashboardFindFirst },
    view: { findFirst: viewFindFirst },
    pluginPanel: { findFirst: pluginPanelFindFirst },
    pluginContextMenu: { findFirst: pluginContextMenuFindFirst },
  };
  const runTransaction = vitest.fn(async (callback) => callback(transactionClient));
  const prismaService = {
    ...transactionClient,
    txClient: () => transactionClient,
    $tx: runTransaction,
  } as unknown as PrismaService;
  const cacheService = {
    get: getAuthCode,
    del: deleteAuthCode,
    set: setAuthCode,
  } as unknown as CacheService;
  const accessTokenService = {} as AccessTokenService;
  const jwtService = { verifyAsync: verifyRefreshToken } as unknown as JwtService;
  const cls = { get: getCls } as unknown as ClsService<IClsStore>;

  const pluginId = 'plgTest';
  const baseId = 'bseTest';
  const authCode = 'auth-code';
  const tokenRo: IPluginGetTokenRo = {
    secret: 'secret',
    scopes: ['base|read'],
    baseId,
    authCode,
  };
  const validRefreshPayload = {
    pluginId,
    secret: tokenRo.secret,
    accessTokenId: 'actOld',
    authorizationVersion: 1,
  };

  let service: PluginAuthService;

  beforeEach(() => {
    vitest.clearAllMocks();
    service = new PluginAuthService(
      prismaService,
      cacheService,
      accessTokenService,
      jwtService,
      cls
    );

    (service as any).validateSecret = vitest.fn().mockResolvedValue({
      pluginUser: 'usrPlugin',
      name: 'Test plugin',
    });
    (service as any).generateAccessToken = vitest.fn().mockResolvedValue({
      id: 'actTest',
      token: 'access-token',
    });
    (service as any).generateRefreshToken = vitest.fn().mockResolvedValue('refresh-token');
    pluginInstallFindMany.mockResolvedValue([
      { id: 'pgiTest', position: PluginPosition.Dashboard, positionId: 'dshTest' },
    ]);
    dashboardFindFirst.mockResolvedValue({ id: 'dshTest' });
    viewFindFirst.mockResolvedValue(null);
    pluginPanelFindFirst.mockResolvedValue(null);
    pluginContextMenuFindFirst.mockResolvedValue(null);
    getAuthCode.mockResolvedValue({ pluginId, baseId });
  });

  it('stores the plugin and base binding in the auth code', async () => {
    await service.authCode(pluginId, baseId);

    expect(setAuthCode).toHaveBeenCalledWith(
      expect.stringMatching(/^plugin:auth-code:/),
      { pluginId, baseId },
      expect.any(Number)
    );
  });

  it('consumes a matching auth code and issues a token', async () => {
    const result = await service.token(pluginId, tokenRo);

    expect(getAuthCode).toHaveBeenCalledWith(`plugin:auth-code:${authCode}`);
    expect(deleteAuthCode).toHaveBeenCalledWith(`plugin:auth-code:${authCode}`);
    expect(pluginInstallFindMany).toHaveBeenCalledWith({
      where: { pluginId, baseId },
      select: { id: true, position: true, positionId: true },
    });
    expect((service as any).generateAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ baseId, clientId: pluginId, scopes: tokenRo.scopes })
    );
    expect(result).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      scopes: tokenRo.scopes,
    });
  });

  it.each([
    ['another plugin', { pluginId: 'plgOther', baseId }],
    ['another base', { pluginId, baseId: 'bseOther' }],
  ])(
    'consumes an auth code issued for %s before rejecting it',
    async (_description, cachedAuthCode) => {
      getAuthCode.mockResolvedValue(cachedAuthCode);

      await expect(service.token(pluginId, tokenRo)).rejects.toMatchObject({
        message: 'Invalid auth code',
        code: HttpErrorCode.VALIDATION_ERROR,
      });
      expect(deleteAuthCode).toHaveBeenCalledWith(`plugin:auth-code:${authCode}`);
      expect(pluginInstallFindMany).not.toHaveBeenCalled();
      expect((service as any).generateAccessToken).not.toHaveBeenCalled();
    }
  );

  it('rejects a missing auth code without deleting it', async () => {
    getAuthCode.mockResolvedValue(undefined);

    await expect(service.token(pluginId, tokenRo)).rejects.toMatchObject({
      message: 'Invalid auth code',
      code: HttpErrorCode.VALIDATION_ERROR,
    });
    expect(deleteAuthCode).not.toHaveBeenCalled();
  });

  it('rejects replay after the auth code has been consumed', async () => {
    getAuthCode.mockResolvedValueOnce({ pluginId, baseId }).mockResolvedValueOnce(undefined);

    await service.token(pluginId, tokenRo);
    await expect(service.token(pluginId, tokenRo)).rejects.toMatchObject({
      message: 'Invalid auth code',
      code: HttpErrorCode.VALIDATION_ERROR,
    });
    expect(deleteAuthCode).toHaveBeenCalledTimes(1);
    expect((service as any).generateAccessToken).toHaveBeenCalledTimes(1);
  });

  it('rejects an auth code when only orphaned plugin installs remain', async () => {
    dashboardFindFirst.mockResolvedValue(null);

    await expect(service.token(pluginId, tokenRo)).rejects.toMatchObject({
      message: 'Plugin not installed',
      code: HttpErrorCode.VALIDATION_ERROR,
    });
    expect((service as any).generateAccessToken).not.toHaveBeenCalled();
  });

  it('rejects invalid or empty token scopes at the schema boundary', () => {
    expect(() => pluginGetTokenRoSchema.parse({ ...tokenRo, scopes: ['invalid|scope'] })).toThrow();
    expect(() => pluginGetTokenRoSchema.parse({ ...tokenRo, scopes: [] })).toThrow();
  });

  it('refreshes a token while the plugin remains installed in the base', async () => {
    verifyRefreshToken.mockResolvedValue(validRefreshPayload);
    findAccessToken.mockResolvedValue({
      baseIds: JSON.stringify([baseId]),
      scopes: JSON.stringify(['base|read']),
    });

    const result = await service.refreshToken(pluginId, {
      secret: tokenRo.secret,
      refreshToken: 'refresh-token-old',
    });

    expect(deleteAccessToken).toHaveBeenCalledWith({
      where: { id: 'actOld', userId: 'usrPlugin' },
    });
    expect(result).toMatchObject({ accessToken: 'access-token', refreshToken: 'refresh-token' });
  });

  it.each([
    JSON.stringify(['space|read']),
    JSON.stringify(['base|read_all']),
    JSON.stringify([]),
    JSON.stringify({ scope: 'base|read' }),
    'invalid-json',
  ])('rejects invalid persisted plugin scopes without rotating the token', async (scopes) => {
    verifyRefreshToken.mockResolvedValue(validRefreshPayload);
    findAccessToken.mockResolvedValue({
      baseIds: JSON.stringify([baseId]),
      scopes,
    });

    await expect(
      service.refreshToken(pluginId, {
        secret: tokenRo.secret,
        refreshToken: 'refresh-token-old',
      })
    ).rejects.toMatchObject({
      message: 'Invalid refresh token',
      code: HttpErrorCode.VALIDATION_ERROR,
    });
    expect(deleteAccessToken).not.toHaveBeenCalled();
    expect((service as any).generateAccessToken).not.toHaveBeenCalled();
    expect((service as any).generateRefreshToken).not.toHaveBeenCalled();
  });

  it('rejects refresh tokens issued before scope authorization was enforced', async () => {
    verifyRefreshToken.mockResolvedValue({
      pluginId,
      secret: tokenRo.secret,
      accessTokenId: 'actOld',
    });

    await expect(
      service.refreshToken(pluginId, {
        secret: tokenRo.secret,
        refreshToken: 'refresh-token-old',
      })
    ).rejects.toMatchObject({
      message: 'Invalid refresh token',
      code: HttpErrorCode.VALIDATION_ERROR,
    });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('rejects refresh after only orphaned plugin installs remain', async () => {
    verifyRefreshToken.mockResolvedValue(validRefreshPayload);
    findAccessToken.mockResolvedValue({
      baseIds: JSON.stringify([baseId]),
      scopes: JSON.stringify(['base|read']),
    });
    dashboardFindFirst.mockResolvedValue(null);

    await expect(
      service.refreshToken(pluginId, {
        secret: tokenRo.secret,
        refreshToken: 'refresh-token-old',
      })
    ).rejects.toMatchObject({
      message: 'Plugin not installed',
      code: HttpErrorCode.VALIDATION_ERROR,
    });
    expect(deleteAccessToken).not.toHaveBeenCalled();
    expect((service as any).generateAccessToken).not.toHaveBeenCalled();
    expect((service as any).generateRefreshToken).not.toHaveBeenCalled();
  });
});
