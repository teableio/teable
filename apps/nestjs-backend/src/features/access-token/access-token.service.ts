import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Action } from '@teable/core';
import { generateAccessTokenId, getRandomString } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  CreateAccessTokenRo,
  RefreshAccessTokenRo,
  UpdateAccessTokenRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { PerformanceCacheService } from '../../performance-cache';
import { generateAccessTokenCacheKey } from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';
import { AccessTokenModel } from '../model/access-token';
import { getAccessToken } from './access-token.encryptor';

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly accessTokenModel: AccessTokenModel,
    private readonly performanceCacheService: PerformanceCacheService
  ) {}

  private transformAccessTokenEntity<
    T extends {
      description?: string | null;
      scopes: string;
      spaceIds: string | null;
      baseIds: string | null;
      createdTime?: Date;
      lastUsedTime?: Date | null;
      expiredTime?: Date;
      hasFullAccess?: boolean | null;
    },
  >(accessTokenEntity: T) {
    const {
      scopes,
      spaceIds,
      baseIds,
      createdTime,
      lastUsedTime,
      expiredTime,
      description,
      hasFullAccess,
    } = accessTokenEntity;
    return {
      ...accessTokenEntity,
      description: description || undefined,
      scopes: JSON.parse(scopes) as Action[],
      spaceIds: spaceIds ? (JSON.parse(spaceIds) as string[]) : undefined,
      baseIds: baseIds ? (JSON.parse(baseIds) as string[]) : undefined,
      createdTime: createdTime?.toISOString(),
      lastUsedTime: lastUsedTime?.toISOString(),
      expiredTime: expiredTime?.toISOString(),
      hasFullAccess: hasFullAccess ?? undefined,
    };
  }

  async validate(splitAccessTokenObj: { accessTokenId: string; sign: string }) {
    const { accessTokenId, sign } = splitAccessTokenObj;
    const accessTokenEntity = await this.accessTokenModel.getAccessTokenRawById(accessTokenId);
    if (!accessTokenEntity) {
      throw new UnauthorizedException('token not found');
    }
    if (sign !== accessTokenEntity.sign) {
      throw new UnauthorizedException('sign error');
    }
    // expiredTime 1ms tolerance
    if (
      accessTokenEntity.expiredTime &&
      new Date(accessTokenEntity.expiredTime).getTime() < Date.now() + 1000
    ) {
      throw new UnauthorizedException('token expired');
    }
    await this.prismaService.accessToken.update({
      where: { id: accessTokenId },
      data: { lastUsedTime: new Date().toISOString() },
    });

    return {
      userId: accessTokenEntity.userId,
      accessTokenId: accessTokenEntity.id,
    };
  }

  async listAccessToken() {
    const userId = this.cls.get('user.id');
    const list = await this.prismaService.accessToken.findMany({
      where: { userId, clientId: null },
      select: {
        id: true,
        name: true,
        description: true,
        scopes: true,
        spaceIds: true,
        baseIds: true,
        hasFullAccess: true,
        createdTime: true,
        expiredTime: true,
        lastUsedTime: true,
      },
      orderBy: { createdTime: 'desc' },
    });
    return list.map(this.transformAccessTokenEntity);
  }

  async createAccessToken(
    createAccessToken: CreateAccessTokenRo & { clientId?: string; userId?: string }
  ) {
    const userId = createAccessToken.userId ?? this.cls.get('user.id')!;
    const { name, description, scopes, spaceIds, baseIds, expiredTime, clientId, hasFullAccess } =
      createAccessToken;
    const id = generateAccessTokenId();
    const sign = getRandomString(16);
    const accessTokenEntity = await this.prismaService.txClient().accessToken.create({
      data: {
        id,
        name,
        description,
        scopes: JSON.stringify(scopes),
        spaceIds: spaceIds === null ? null : JSON.stringify(spaceIds),
        baseIds: baseIds === null ? null : JSON.stringify(baseIds),
        userId,
        sign,
        clientId,
        expiredTime: new Date(expiredTime).toISOString(),
        hasFullAccess,
      },
      select: {
        id: true,
        name: true,
        description: true,
        scopes: true,
        spaceIds: true,
        baseIds: true,
        expiredTime: true,
        createdTime: true,
        lastUsedTime: true,
        hasFullAccess: true,
      },
    });
    return {
      ...this.transformAccessTokenEntity(accessTokenEntity),
      token: getAccessToken(id, sign),
    };
  }

  async deleteAccessToken(id: string) {
    const userId = this.cls.get('user.id');
    await this.prismaService.accessToken.delete({
      where: { id, userId },
    });
  }

  async refreshAccessToken(id: string, refreshAccessTokenRo?: RefreshAccessTokenRo) {
    const userId = this.cls.get('user.id');

    const sign = getRandomString(16);
    const expiredTime = refreshAccessTokenRo?.expiredTime;
    const accessTokenEntity = await this.prismaService.accessToken.update({
      where: { id, userId },
      data: {
        sign,
        expiredTime: expiredTime ? new Date(expiredTime).toISOString() : undefined,
      },
      select: {
        id: true,
        name: true,
        description: true,
        scopes: true,
        spaceIds: true,
        baseIds: true,
        expiredTime: true,
        lastUsedTime: true,
      },
    });
    await this.performanceCacheService.del(generateAccessTokenCacheKey(id));
    return {
      ...this.transformAccessTokenEntity(accessTokenEntity),
      token: getAccessToken(id, sign),
    };
  }

  async updateAccessToken(id: string, updateAccessToken: UpdateAccessTokenRo) {
    const userId = this.cls.get('user.id');
    const { name, description, scopes, spaceIds, baseIds, hasFullAccess } = updateAccessToken;
    const accessTokenEntity = await this.prismaService.accessToken.update({
      where: { id, userId },
      data: {
        name,
        description,
        scopes: JSON.stringify(scopes),
        spaceIds: spaceIds === null ? null : JSON.stringify(spaceIds),
        baseIds: baseIds === null ? null : JSON.stringify(baseIds),
        hasFullAccess,
      },
      select: {
        id: true,
        name: true,
        description: true,
        scopes: true,
        spaceIds: true,
        baseIds: true,
        hasFullAccess: true,
      },
    });
    await this.performanceCacheService.del(generateAccessTokenCacheKey(id));
    return this.transformAccessTokenEntity(accessTokenEntity);
  }

  async getAccessToken(accessTokenId: string) {
    const userId = this.cls.get('user.id');
    const item = await this.prismaService.accessToken.findFirstOrThrow({
      where: { userId, id: accessTokenId },
      select: {
        id: true,
        name: true,
        description: true,
        scopes: true,
        spaceIds: true,
        baseIds: true,
        createdTime: true,
        expiredTime: true,
        lastUsedTime: true,
        hasFullAccess: true,
      },
    });
    const res = this.transformAccessTokenEntity(item);
    // filter deleted spaceIds and baseIds
    const { spaceIds, baseIds } = res;
    let filteredSpaceIds: string[] | undefined;
    let filteredBaseIds: string[] | undefined;
    if (spaceIds) {
      const spaces = await this.prismaService.space.findMany({
        where: { id: { in: spaceIds }, deletedTime: null },
        select: { id: true },
      });
      filteredSpaceIds = spaces.map((space) => space.id);
    }
    if (baseIds) {
      const bases = await this.prismaService.base.findMany({
        where: { id: { in: baseIds }, deletedTime: null },
        select: { id: true },
      });
      filteredBaseIds = bases.map((base) => base.id);
    }
    return {
      ...res,
      spaceIds: filteredSpaceIds,
      baseIds: filteredBaseIds,
    };
  }
}
