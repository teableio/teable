import { ForbiddenException, NotFoundException, Injectable } from '@nestjs/common';
import type { BaseRole, PermissionAction, SpaceRole } from '@teable/core';
import { IdPrefix, getPermissions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { intersection } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { RoleType } from '../../../../../packages/core/src/auth/types';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class PermissionService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async getRoleBySpaceId(spaceId: string) {
    const userId = this.cls.get('user.id');

    const collaborator = await this.prismaService.collaborator.findFirst({
      where: {
        userId,
        spaceId,
        baseId: null,
        deletedTime: null,
      },
      select: { roleName: true },
    });
    if (!collaborator) {
      throw new ForbiddenException(`can't find collaborator`);
    }
    return collaborator.roleName as SpaceRole;
  }

  async getRoleByBaseId(baseId: string) {
    const userId = this.cls.get('user.id');

    const collaborator = await this.prismaService.collaborator.findFirst({
      where: {
        userId,
        spaceId: null,
        baseId,
        deletedTime: null,
      },
      select: { roleName: true },
    });
    if (!collaborator) {
      return null;
    }
    return collaborator.roleName as BaseRole;
  }

  async getOAuthAccessBy(userId: string) {
    const collaborator = await this.prismaService.txClient().collaborator.findMany({
      where: {
        userId,
        deletedTime: null,
      },
      select: { roleName: true, spaceId: true, baseId: true },
    });

    const spaceIds: string[] = [];
    const baseIds: string[] = [];
    collaborator.forEach(({ baseId, spaceId }) => {
      if (baseId) {
        baseIds.push(baseId);
      } else if (spaceId) {
        spaceIds.push(spaceId);
      }
    });

    return { spaceIds, baseIds };
  }

  async getAccessToken(accessTokenId: string) {
    const {
      scopes: stringifyScopes,
      spaceIds,
      baseIds,
      clientId,
      userId,
    } = await this.prismaService.accessToken.findFirstOrThrow({
      where: { id: accessTokenId },
      select: { scopes: true, spaceIds: true, baseIds: true, clientId: true, userId: true },
    });
    const scopes = JSON.parse(stringifyScopes) as PermissionAction[];
    if (clientId) {
      const { spaceIds: spaceIdsByOAuth, baseIds: baseIdsByOAuth } =
        await this.getOAuthAccessBy(userId);
      return {
        scopes,
        spaceIds: spaceIdsByOAuth,
        baseIds: baseIdsByOAuth,
      };
    }
    return {
      scopes,
      spaceIds: spaceIds ? JSON.parse(spaceIds) : undefined,
      baseIds: baseIds ? JSON.parse(baseIds) : undefined,
    };
  }

  async getUpperIdByTableId(tableId: string): Promise<{ spaceId: string; baseId: string }> {
    const table = await this.prismaService.tableMeta.findFirst({
      where: {
        id: tableId,
        deletedTime: null,
      },
      select: {
        base: true,
      },
    });
    const baseId = table?.base.id;
    const spaceId = table?.base?.spaceId;
    if (!spaceId || !baseId) {
      throw new NotFoundException(`Invalid tableId: ${tableId}`);
    }
    return { baseId, spaceId };
  }

  async getUpperIdByBaseId(baseId: string): Promise<{ spaceId: string }> {
    const base = await this.prismaService.base.findFirst({
      where: {
        id: baseId,
        deletedTime: null,
      },
      select: {
        spaceId: true,
      },
    });
    const spaceId = base?.spaceId;
    if (!spaceId) {
      throw new NotFoundException(`Invalid baseId: ${baseId}`);
    }
    return { spaceId };
  }
  private async isBaseIdAllowedForResource(
    baseId: string,
    spaceIds: string[] | undefined,
    baseIds: string[] | undefined
  ) {
    const upperId = await this.getUpperIdByBaseId(baseId);
    return spaceIds?.includes(upperId.spaceId) || baseIds?.includes(baseId);
  }

  private async isTableIdAllowedForResource(
    tableId: string,
    spaceIds: string[] | undefined,
    baseIds: string[] | undefined
  ) {
    const { spaceId, baseId } = await this.getUpperIdByTableId(tableId);
    return spaceIds?.includes(spaceId) || baseIds?.includes(baseId);
  }

  async getPermissionsByAccessToken(resourceId: string, accessTokenId: string) {
    const { scopes, spaceIds, baseIds } = await this.getAccessToken(accessTokenId);

    if (
      !resourceId.startsWith(IdPrefix.Space) &&
      !resourceId.startsWith(IdPrefix.Base) &&
      !resourceId.startsWith(IdPrefix.Table)
    ) {
      throw new ForbiddenException(`${resourceId} is not valid`);
    }

    if (resourceId.startsWith(IdPrefix.Space) && !spaceIds?.includes(resourceId)) {
      throw new ForbiddenException(`not allowed to space ${resourceId}`);
    }

    if (
      resourceId.startsWith(IdPrefix.Base) &&
      !(await this.isBaseIdAllowedForResource(resourceId, spaceIds, baseIds))
    ) {
      throw new ForbiddenException(`not allowed to base ${resourceId}`);
    }

    if (
      resourceId.startsWith(IdPrefix.Table) &&
      !(await this.isTableIdAllowedForResource(resourceId, spaceIds, baseIds))
    ) {
      throw new ForbiddenException(`not allowed to table ${resourceId}`);
    }

    return scopes;
  }

  private async getPermissionBySpaceId(spaceId: string) {
    const role = await this.getRoleBySpaceId(spaceId);
    return getPermissions(RoleType.Space, role);
  }

  private async getPermissionByBaseId(baseId: string) {
    const role = await this.getRoleByBaseId(baseId);
    if (role) {
      return getPermissions(RoleType.Base, role);
    }
    return this.getPermissionBySpaceId((await this.getUpperIdByBaseId(baseId)).spaceId);
  }

  private async getPermissionByTableId(tableId: string) {
    const baseId = (await this.getUpperIdByTableId(tableId)).baseId;
    return this.getPermissionByBaseId(baseId);
  }

  async getPermissionsByResourceId(resourceId: string) {
    if (resourceId.startsWith(IdPrefix.Space)) {
      return await this.getPermissionBySpaceId(resourceId);
    } else if (resourceId.startsWith(IdPrefix.Base)) {
      return await this.getPermissionByBaseId(resourceId);
    } else if (resourceId.startsWith(IdPrefix.Table)) {
      return await this.getPermissionByTableId(resourceId);
    } else {
      throw new ForbiddenException('request path is not valid');
    }
  }

  async getPermissions(resourceId: string, accessTokenId?: string) {
    const userPermissions = await this.getPermissionsByResourceId(resourceId);

    if (accessTokenId) {
      const accessTokenPermission = await this.getPermissionsByAccessToken(
        resourceId,
        accessTokenId
      );
      return intersection(userPermissions, accessTokenPermission);
    }
    return userPermissions;
  }

  async validPermissions(
    resourceId: string,
    permissions: PermissionAction[],
    accessTokenId?: string
  ) {
    const ownPermissions = await this.getPermissions(resourceId, accessTokenId);
    if (permissions.every((permission) => ownPermissions.includes(permission))) {
      return ownPermissions;
    }
    throw new ForbiddenException(
      `not allowed to operate ${permissions.join(', ')} on ${resourceId}`
    );
  }
}
