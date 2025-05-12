import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRandomString } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  PluginStatus,
  type IPluginGetTokenRo,
  type IPluginGetTokenVo,
  type IPluginRefreshTokenRo,
  type IPluginRefreshTokenVo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../cache/cache.service';
import type { IClsStore } from '../../types/cls';
import { second } from '../../utils/second';
import { AccessTokenService } from '../access-token/access-token.service';
import { validateSecret } from './utils';

interface IRefreshPayload {
  pluginId: string;
  secret: string;
  accessTokenId: string;
}

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
    scopes: string[];
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

  private async generateRefreshToken({ pluginId, secret, accessTokenId }: IRefreshPayload) {
    return this.jwtService.signAsync(
      {
        secret,
        accessTokenId,
        pluginId,
      },
      { expiresIn: this.refreshTokenExpireIn }
    );
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
        throw new NotFoundException('Plugin not found');
      });
    if (!plugin.pluginUser) {
      throw new BadRequestException('Plugin user not found');
    }
    const checkSecret = await validateSecret(secret, plugin.secret);
    if (!checkSecret) {
      throw new BadRequestException('Invalid secret');
    }
    return {
      ...plugin,
      pluginUser: plugin.pluginUser,
    };
  }

  async token(pluginId: string, ro: IPluginGetTokenRo): Promise<IPluginGetTokenVo> {
    const { secret, scopes, baseId } = ro;
    const plugin = await this.validateSecret(secret, pluginId);

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
      // eslint-disable-next-line sonarjs/no-duplicate-string
      throw new BadRequestException('Invalid refresh token');
    });

    if (
      payload.pluginId !== pluginId ||
      payload.secret !== secret ||
      payload.accessTokenId === undefined
    ) {
      throw new BadRequestException('Invalid refresh token');
    }
    return this.prismaService.$tx(async (prisma) => {
      const oldAccessToken = await prisma.accessToken
        .findFirstOrThrow({
          where: { id: payload.accessTokenId },
        })
        .catch(() => {
          throw new BadRequestException('Invalid refresh token');
        });

      await prisma.accessToken.delete({
        where: { id: payload.accessTokenId, userId: plugin.pluginUser },
      });

      const baseId = oldAccessToken.baseIds ? JSON.parse(oldAccessToken.baseIds)[0] : '';
      const scopes = oldAccessToken.scopes ? JSON.parse(oldAccessToken.scopes) : [];
      if (!baseId) {
        throw new InternalServerErrorException('Anomalous token with no baseId');
      }

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
    const count = await this.prismaService.pluginInstall.count({
      where: { pluginId, baseId },
    });
    if (count === 0) {
      throw new NotFoundException('Plugin not installed');
    }
    const authCode = getRandomString(16);
    await this.cacheService.set(`plugin:auth-code:${authCode}`, { baseId, pluginId }, second('5m'));
    return authCode;
  }
}
