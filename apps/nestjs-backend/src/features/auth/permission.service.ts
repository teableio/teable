import { ForbiddenException, NotFoundException, Injectable } from '@nestjs/common';
import type { PermissionAction, SpaceRole } from '@teable/core';
import { IdPrefix, checkPermissions, getPermissions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class PermissionService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}
  private async getRoleBySpaceId(spaceId: string) {
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

  private async getRoleByBaseId(baseId: string) {
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
    return collaborator.roleName as SpaceRole;
  }

  async checkPermissionBySpaceId(spaceId: string, permissions: PermissionAction[]) {
    const role = await this.getRoleBySpaceId(spaceId);
    if (!checkPermissions(role, permissions)) {
      throw new ForbiddenException(`not allowed to space ${spaceId}`);
    }
    return getPermissions(role);
  }

  async checkPermissionByBaseId(baseId: string, permissions: PermissionAction[]) {
    const base = await this.prismaService.base.findFirst({
      where: { id: baseId, deletedTime: null },
      select: { spaceId: true },
    });
    if (!base) {
      throw new NotFoundException(`not found ${baseId}`);
    }
    const baseRole = await this.getRoleByBaseId(baseId);
    if (baseRole && checkPermissions(baseRole, permissions)) {
      return getPermissions(baseRole);
    }
    const spaceRole = await this.getRoleBySpaceId(base.spaceId);
    if (spaceRole && checkPermissions(spaceRole, permissions)) {
      return getPermissions(spaceRole);
    }
    throw new ForbiddenException(`not allowed to base ${baseId}`);
  }

  async checkPermissionByTableId(tableId: string, permissions: PermissionAction[]) {
    const table = await this.prismaService.tableMeta.findFirst({
      where: {
        id: tableId,
        deletedTime: null,
      },
      select: {
        base: true,
      },
    });
    if (!table) {
      throw new NotFoundException(`not found ${tableId}`);
    }
    return await this.checkPermissionByBaseId(table.base.id, permissions);
  }

  async getAccessToken(accessTokenId: string) {
    const { scopes, spaceIds, baseIds } = await this.prismaService.accessToken.findFirstOrThrow({
      where: { id: accessTokenId },
      select: { scopes: true, spaceIds: true, baseIds: true },
    });
    return {
      scopes: JSON.parse(scopes) as PermissionAction[],
      spaceIds: spaceIds ? JSON.parse(spaceIds) : undefined,
      baseIds: baseIds ? JSON.parse(baseIds) : undefined,
    };
  }

  async checkPermissionByAccessToken(
    resourceId: string,
    accessTokenId: string,
    permissions: PermissionAction[]
  ) {
    const { scopes, spaceIds, baseIds } = await this.getAccessToken(accessTokenId);

    if (resourceId.startsWith(IdPrefix.Table)) {
      const table = await this.prismaService.tableMeta.findFirst({
        where: {
          id: resourceId,
          deletedTime: null,
        },
        select: {
          base: true,
        },
      });
      const baseId = table?.base.id;
      if (!baseId) {
        throw new NotFoundException(`not found ${resourceId}`);
      }
      resourceId = baseId;
    }
    if (resourceId.startsWith(IdPrefix.Space) && !spaceIds?.includes(resourceId)) {
      throw new ForbiddenException(`not allowed to space ${resourceId}`);
    }
    if (resourceId.startsWith(IdPrefix.Base) && !baseIds?.includes(resourceId)) {
      throw new ForbiddenException(`not allowed to base ${resourceId}`);
    }

    const accessTokenPermissions = scopes;
    if (permissions.some((permission) => !accessTokenPermissions.includes(permission))) {
      throw new ForbiddenException(`not allowed to ${resourceId}`);
    }

    return scopes;
  }
}
