/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpErrorCode } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import {
  pluginBaseActions,
  PluginPosition,
  pluginGetTokenRoSchema,
  type IPluginGetTokenRo,
} from '@teable/openapi';
import type { ClsService } from 'nestjs-cls';
import type { CacheService } from '../../cache/cache.service';
import type { IClsStore } from '../../types/cls';
import type { AccessTokenService } from '../access-token/access-token.service';
import type { AuditScope } from '../audit/audit-scope';
import type { TeableJwtService } from '../auth/jwt/teable-jwt.service';
import type { PermissionService } from '../auth/permission.service';
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
  const jwtService = { verifyAsync: verifyRefreshToken } as unknown as TeableJwtService;
  const cls = { get: getCls } as unknown as ClsService<IClsStore>;
  const emitAtomic = vitest.fn();
  const audit = { emitAtomic } as unknown as AuditScope;
  const getPermissionByBaseId = vitest.fn();
  const permissionService = { getPermissionByBaseId } as unknown as PermissionService;

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
      cls,
      audit,
      permissionService
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
    getCls.mockReturnValue('usrMinter');
    getPermissionByBaseId.mockResolvedValue(['base|read']);
    getAuthCode.mockResolvedValue({
      pluginId,
      baseId,
      userId: 'usrMinter',
      scopes: ['base|read'],
    });
  });

  it('binds the auth code to its minter and the scopes that minter may grant', async () => {
    getPermissionByBaseId.mockResolvedValue(['base|read', 'record|read', 'record|update']);

    await service.authCode(pluginId, baseId);

    expect(getPermissionByBaseId).toHaveBeenCalledWith(baseId);
    const [cacheKey, stored] = setAuthCode.mock.calls[0];
    expect(cacheKey).toMatch(/^plugin:auth-code:/);
    expect(stored).toMatchObject({ pluginId, baseId, userId: 'usrMinter' });
    expect([...stored.scopes].sort()).toEqual(['base|read', 'record|read', 'record|update'].sort());
  });

  it('snapshots only the base permissions that are valid plugin scopes', async () => {
    // A base role may grant actions that are not grantable to a plugin token (e.g. seat/
    // permission management); those must never enter the snapshot.
    getPermissionByBaseId.mockResolvedValue([
      'base|read',
      'base|invite_email',
      'base|authority_matrix_config',
    ]);

    await service.authCode(pluginId, baseId);

    const [, stored] = setAuthCode.mock.calls[0];
    expect(stored.scopes).toEqual(['base|read']);
  });

  it('audits the auth code as the signed-in user authorizing the plugin for the base', async () => {
    await service.authCode(pluginId, baseId);

    expect(emitAtomic).toHaveBeenCalledTimes(1);
    expect(emitAtomic).toHaveBeenCalledWith({
      action: 'plugin.authorize',
      resourceId: pluginId,
      payload: undefined,
      params: { baseId },
    });
  });

  it('does not audit an auth code for a plugin that is not installed in the base', async () => {
    dashboardFindFirst.mockResolvedValue(null);

    await expect(service.authCode(pluginId, baseId)).rejects.toMatchObject({
      message: 'Plugin not installed',
    });
    expect(emitAtomic).not.toHaveBeenCalled();
  });

  it('audits the code exchange as the plugin bot, with scopes and without any token', async () => {
    await service.token(pluginId, tokenRo);

    expect(emitAtomic).toHaveBeenCalledTimes(1);
    expect(emitAtomic).toHaveBeenCalledWith({
      action: 'plugin.token.issue',
      resourceId: pluginId,
      userId: 'usrPlugin',
      params: { baseId, scopes: tokenRo.scopes },
    });
    const serialized = JSON.stringify(emitAtomic.mock.calls);
    expect(serialized).not.toContain(tokenRo.secret);
    expect(serialized).not.toContain('access-token');
    expect(serialized).not.toContain(authCode);
  });

  it('does not audit a rejected code exchange or a refresh', async () => {
    getAuthCode.mockResolvedValue(undefined);
    await expect(service.token(pluginId, tokenRo)).rejects.toThrow();

    verifyRefreshToken.mockResolvedValue(validRefreshPayload);
    findAccessToken.mockResolvedValue({
      baseIds: JSON.stringify([baseId]),
      scopes: JSON.stringify(['base|read']),
    });
    await service.refreshToken(pluginId, {
      secret: tokenRo.secret,
      refreshToken: 'refresh-token-old',
    });

    expect(emitAtomic).not.toHaveBeenCalled();
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

  it('caps the issued scopes to what the code minter could grant, dropping the rest', async () => {
    // A Viewer-minted code (read-only snapshot) exchanged for record|update must not yield it,
    // even though the token is seated as the plugin bot. This is the core privilege-escalation fix.
    getAuthCode.mockResolvedValue({
      pluginId,
      baseId,
      userId: 'usrViewer',
      scopes: ['base|read', 'record|read'],
    });
    const ro: IPluginGetTokenRo = { ...tokenRo, scopes: ['record|read', 'record|update'] };

    const result = await service.token(pluginId, ro);

    expect((service as any).generateAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['record|read'] })
    );
    expect(result.scopes).toEqual(['record|read']);
    expect(emitAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ params: { baseId, scopes: ['record|read'] } })
    );
  });

  it('rejects a code whose minter could grant none of the requested scopes', async () => {
    getAuthCode.mockResolvedValue({
      pluginId,
      baseId,
      userId: 'usrViewer',
      scopes: ['base|read'],
    });
    const ro: IPluginGetTokenRo = { ...tokenRo, scopes: ['record|update'] };

    await expect(service.token(pluginId, ro)).rejects.toMatchObject({
      message: 'Invalid auth code',
      code: HttpErrorCode.VALIDATION_ERROR,
    });
    expect(deleteAuthCode).toHaveBeenCalledWith(`plugin:auth-code:${authCode}`);
    expect(pluginInstallFindMany).not.toHaveBeenCalled();
    expect((service as any).generateAccessToken).not.toHaveBeenCalled();
  });

  it('rejects, fail-closed, a legacy auth code minted before scopes were snapshotted', async () => {
    getAuthCode.mockResolvedValue({ pluginId, baseId });

    await expect(service.token(pluginId, tokenRo)).rejects.toMatchObject({
      message: 'Invalid auth code',
      code: HttpErrorCode.VALIDATION_ERROR,
    });
    expect((service as any).generateAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a missing auth code without deleting it', async () => {
    getAuthCode.mockResolvedValue(undefined);

    await expect(service.token(pluginId, tokenRo)).rejects.toMatchObject({
      message: 'Invalid auth code',
      code: HttpErrorCode.VALIDATION_ERROR,
    });
    expect(deleteAuthCode).not.toHaveBeenCalled();
  });

  it('rejects replay after the auth code has been consumed', async () => {
    getAuthCode
      .mockResolvedValueOnce({ pluginId, baseId, userId: 'usrMinter', scopes: ['base|read'] })
      .mockResolvedValueOnce(undefined);

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

  it('never offers base-management scopes to a plugin token', () => {
    const forbidden = ['base|authority_matrix_config', 'base|invite_email', 'base|invite_link'];
    for (const scope of forbidden) {
      expect(pluginBaseActions).not.toContain(scope);
      expect(() => pluginGetTokenRoSchema.parse({ ...tokenRo, scopes: [scope] })).toThrow();
    }
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
