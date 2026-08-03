/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRandomString, HttpErrorCode } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import {
  PluginPosition,
  PluginStatus,
  pluginBaseScopesSchema,
  type PluginBaseAction,
  type IPluginGetTokenRo,
  type IPluginGetTokenVo,
  type IPluginRefreshTokenRo,
  type IPluginRefreshTokenVo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../cache/cache.service';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { second } from '../../utils/second';
import { AccessTokenService } from '../access-token/access-token.service';
import { validateSecret } from './utils';

interface IRefreshTokenInput {
  pluginId: string;
  secret: string;
  accessTokenId: string;
}

interface IRefreshPayload extends IRefreshTokenInput {
  authorizationVersion: number;
}

const authorizationVersion = 1;

@Injectable()
export class PluginAuthService {
  accessTokenExpireIn = second('10m');
  refreshTokenExpireIn = second('30d');

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    private readonly accessTokenService: AccessTokenService,
    private readonly jwtService: JwtService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  private generateAccessToken({
    userId,
    scopes,
    clientId,
    name,
    baseId,
  }: {
    userId: string;
    scopes: PluginBaseAction[];
    clientId: string;
    name: string;
    baseId: string;
  }) {
    return this.accessTokenService.createAccessToken({
      clientId,
      name: `plugin:${name}`,
      scopes,
      userId,
      baseIds: [baseId],
      // 10 minutes
      expiredTime: new Date(Date.now() + this.accessTokenExpireIn * 1000).toISOString(),
    });
  }

  private async generateRefreshToken({ pluginId, secret, accessTokenId }: IRefreshTokenInput) {
    return this.jwtService.signAsync(
      {
        secret,
        accessTokenId,
        pluginId,
        authorizationVersion,
      },
      { expiresIn: this.refreshTokenExpireIn }
    );
  }

  private pluginNotInstalledError() {
    return new CustomHttpException('Plugin not installed', HttpErrorCode.VALIDATION_ERROR, {
      localization: {
        i18nKey: 'httpErrors.pluginInstall.notFound',
      },
    });
  }

  private async hasActivePluginInstall(
    prisma: Prisma.TransactionClient,
    pluginId: string,
    baseId: string
  ) {
    const installs = await prisma.pluginInstall.findMany({
      where: { pluginId, baseId },
      select: { id: true, position: true, positionId: true },
    });
    const positionIds = (position: PluginPosition) => [
      ...new Set(
        installs
          .filter((install) => install.position === position)
          .map((install) => install.positionId)
      ),
    ];
    const dashboardIds = positionIds(PluginPosition.Dashboard);
    const viewIds = positionIds(PluginPosition.View);
    const panelIds = positionIds(PluginPosition.Panel);
    const contextInstalls = installs.filter(
      (install) => install.position === PluginPosition.ContextMenu
    );

    const activeParents = await Promise.all([
      dashboardIds.length
        ? prisma.dashboard.findFirst({
            where: { id: { in: dashboardIds }, baseId },
            select: { id: true },
          })
        : null,
      viewIds.length
        ? prisma.view.findFirst({
            where: {
              id: { in: viewIds },
              deletedTime: null,
              table: { baseId, deletedTime: null },
            },
            select: { id: true },
          })
        : null,
      panelIds.length
        ? prisma.pluginPanel.findFirst({
            where: { id: { in: panelIds }, table: { baseId, deletedTime: null } },
            select: { id: true },
          })
        : null,
      contextInstalls.length
        ? prisma.pluginContextMenu.findFirst({
            where: {
              OR: contextInstalls.map(({ id, positionId }) => ({
                pluginInstallId: id,
                tableId: positionId,
              })),
              table: { baseId, deletedTime: null },
            },
            select: { id: true },
          })
        : null,
    ]);
    return activeParents.some(Boolean);
  }

  private async assertPluginInstalled(
    prisma: Prisma.TransactionClient,
    pluginId: string,
    baseId: string
  ) {
    if (!(await this.hasActivePluginInstall(prisma, pluginId, baseId))) {
      throw this.pluginNotInstalledError();
    }
  }

  private parseRefreshTokenScopes(scopes: string | null): PluginBaseAction[] {
    try {
      return pluginBaseScopesSchema.parse(scopes ? JSON.parse(scopes) : []);
    } catch {
      throw new CustomHttpException('Invalid refresh token', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.plugin.invalidRefreshToken',
        },
      });
    }
  }

  private async validateSecret(secret: string, pluginId: string) {
    const plugin = await this.prismaService.plugin
      .findFirstOrThrow({
        where: {
          id: pluginId,
          OR: [
            {
              status: PluginStatus.Published,
            },
            {
              status: { not: PluginStatus.Published },
              createdBy: this.cls.get('user.id'),
            },
          ],
        },
      })
      .catch(() => {
        throw new CustomHttpException('Plugin not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.plugin.notFound',
          },
        });
      });
    if (!plugin.pluginUser) {
      throw new CustomHttpException('Plugin user not found', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.plugin.userNotFound',
        },
      });
    }
    const checkSecret = await validateSecret(secret, plugin.secret);
    if (!checkSecret) {
      throw new CustomHttpException('Invalid secret', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.plugin.invalidSecret',
        },
      });
    }
    return {
      ...plugin,
      pluginUser: plugin.pluginUser,
    };
  }

  async token(pluginId: string, ro: IPluginGetTokenRo): Promise<IPluginGetTokenVo> {
    const { secret, scopes, baseId, authCode } = ro;
    const plugin = await this.validateSecret(secret, pluginId);
    const authCodeKey = `plugin:auth-code:${authCode}` as const;
    const authCodeState = await this.cacheService.get(authCodeKey);
    if (!authCodeState) {
      throw new CustomHttpException('Invalid auth code', HttpErrorCode.VALIDATION_ERROR);
    }
    await this.cacheService.del(authCodeKey);

    if (authCodeState.pluginId !== pluginId || authCodeState.baseId !== baseId) {
      throw new CustomHttpException('Invalid auth code', HttpErrorCode.VALIDATION_ERROR);
    }

    await this.assertPluginInstalled(this.prismaService.txClient(), pluginId, baseId);

    const accessToken = await this.generateAccessToken({
      userId: plugin.pluginUser,
      scopes,
      baseId,
      clientId: pluginId,
      name: plugin.name,
    });

    const refreshToken = await this.generateRefreshToken({
      pluginId,
      secret,
      accessTokenId: accessToken.id,
    });

    return {
      accessToken: accessToken.token,
      refreshToken,
      scopes,
      expiresIn: this.accessTokenExpireIn,
      refreshExpiresIn: this.refreshTokenExpireIn,
    };
  }

  async refreshToken(pluginId: string, ro: IPluginRefreshTokenRo): Promise<IPluginRefreshTokenVo> {
    const { secret, refreshToken } = ro;
    const plugin = await this.validateSecret(secret, pluginId);
    const payload = await this.jwtService.verifyAsync<IRefreshPayload>(refreshToken).catch(() => {
      throw new CustomHttpException('Invalid refresh token', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.plugin.invalidRefreshToken',
        },
      });
    });

    if (
      payload.pluginId !== pluginId ||
      payload.secret !== secret ||
      payload.accessTokenId === undefined ||
      payload.authorizationVersion !== authorizationVersion
    ) {
      throw new CustomHttpException('Invalid refresh token', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.plugin.invalidRefreshToken',
        },
      });
    }
    return this.prismaService.$tx(async (prisma) => {
      const oldAccessToken = await prisma.accessToken
        .findFirstOrThrow({
          where: { id: payload.accessTokenId },
        })
        .catch(() => {
          throw new CustomHttpException('Invalid refresh token', HttpErrorCode.VALIDATION_ERROR, {
            localization: {
              i18nKey: 'httpErrors.plugin.invalidRefreshToken',
            },
          });
        });

      const baseId = oldAccessToken.baseIds ? JSON.parse(oldAccessToken.baseIds)[0] : '';
      const scopes = this.parseRefreshTokenScopes(oldAccessToken.scopes);
      if (!baseId) {
        throw new CustomHttpException(
          'Anomalous token with no baseId',
          HttpErrorCode.INTERNAL_SERVER_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.plugin.anomalousToken',
            },
          }
        );
      }

      await this.assertPluginInstalled(prisma, pluginId, baseId);

      await prisma.accessToken.delete({
        where: { id: payload.accessTokenId, userId: plugin.pluginUser },
      });

      const accessToken = await this.generateAccessToken({
        userId: plugin.pluginUser,
        scopes,
        baseId,
        clientId: pluginId,
        name: plugin.name,
      });

      const refreshToken = await this.generateRefreshToken({
        pluginId,
        secret,
        accessTokenId: accessToken.id,
      });
      return {
        accessToken: accessToken.token,
        refreshToken,
        scopes,
        expiresIn: this.accessTokenExpireIn,
        refreshExpiresIn: this.refreshTokenExpireIn,
      };
    });
  }

  async authCode(pluginId: string, baseId: string) {
    await this.assertPluginInstalled(this.prismaService.txClient(), pluginId, baseId);
    const authCode = getRandomString(16);
    await this.cacheService.set(`plugin:auth-code:${authCode}`, { baseId, pluginId }, second('5m'));
    return authCode;
  }
}
