import { ForbiddenException, NotFoundException, Injectable } from '@nestjs/common';
import type { IBaseRole, Action, IRole } from '@teable/core';
import { IdPrefix, getPermissions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType } from '@teable/openapi';
import { intersection } from 'lodash';
import { ClsService } from 'nestjs-cls';
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
        resourceId: spaceId,
        resourceType: CollaboratorType.Space,
      },
      select: { roleName: true },
    });
    if (!collaborator) {
      throw new ForbiddenException(`you have no permission to access this space`);
    }
    return collaborator.roleName as IRole;
  }

  async getRoleByBaseId(baseId: string) {
    const userId = this.cls.get('user.id');

    const collaborator = await this.prismaService.collaborator.findFirst({
      where: {
        userId,
        resourceId: baseId,
        resourceType: CollaboratorType.Base,
      },
      select: { roleName: true },
    });
    if (!collaborator) {
      return null;
    }
    return collaborator.roleName as IBaseRole;
  }

  async getOAuthAccessBy(userId: string) {
    const collaborator = await this.prismaService.txClient().collaborator.findMany({
      where: {
        userId,
      },
      select: { roleName: true, resourceId: true, resourceType: true },
    });

    const spaceIds: string[] = [];
    const baseIds: string[] = [];
    collaborator.forEach(({ resourceId, resourceType }) => {
      if (resourceType === CollaboratorType.Base) {
        baseIds.push(resourceId);
      } else if (resourceType === CollaboratorType.Space) {
        spaceIds.push(resourceId);
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
    const scopes = JSON.parse(stringifyScopes) as Action[];
    if (clientId && clientId.startsWith(IdPrefix.OAuthClient)) {
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

  async getUpperIdByTableId(
    tableId: string,
    includeInactiveResource?: boolean
  ): Promise<{ spaceId: string; baseId: string }> {
    const table = await this.prismaService.txClient().tableMeta.findFirst({
      where: {
        id: tableId,
        ...(includeInactiveResource ? {} : { deletedTime: null }),
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

  async getUpperIdByBaseId(
    baseId: string,
    includeInactiveResource?: boolean
  ): Promise<{ spaceId: string }> {
    const base = await this.prismaService.base.findFirst({
      where: {
        id: baseId,
        ...(includeInactiveResource ? {} : { deletedTime: null }),
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
    baseIds: string[] | undefined,
    includeInactiveResource?: boolean
  ) {
    const upperId = await this.getUpperIdByBaseId(baseId, includeInactiveResource);
    return spaceIds?.includes(upperId.spaceId) || baseIds?.includes(baseId);
  }

  private async isTableIdAllowedForResource(
    tableId: string,
    spaceIds: string[] | undefined,
    baseIds: string[] | undefined,
    includeInactiveResource?: boolean
  ) {
    const { spaceId, baseId } = await this.getUpperIdByTableId(tableId, includeInactiveResource);
    return spaceIds?.includes(spaceId) || baseIds?.includes(baseId);
  }

  async getPermissionsByAccessToken(
    resourceId: string,
    accessTokenId: string,
    includeInactiveResource?: boolean
  ) {
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
      !(await this.isBaseIdAllowedForResource(
        resourceId,
        spaceIds,
        baseIds,
        includeInactiveResource
      ))
    ) {
      throw new ForbiddenException(`not allowed to base ${resourceId}`);
    }

    if (
      resourceId.startsWith(IdPrefix.Table) &&
      !(await this.isTableIdAllowedForResource(
        resourceId,
        spaceIds,
        baseIds,
        includeInactiveResource
      ))
    ) {
      throw new ForbiddenException(`not allowed to table ${resourceId}`);
    }

    return scopes;
  }

  private async getPermissionBySpaceId(spaceId: string) {
    const role = await this.getRoleBySpaceId(spaceId);
    return getPermissions(role);
  }

  private async getPermissionByBaseId(baseId: string, includeInactiveResource?: boolean) {
    const role = await this.getRoleByBaseId(baseId);
    if (role) {
      return getPermissions(role);
    }
    return this.getPermissionBySpaceId(
      (await this.getUpperIdByBaseId(baseId, includeInactiveResource)).spaceId
    );
  }

  private async getPermissionByTableId(tableId: string, includeInactiveResource?: boolean) {
    const baseId = (await this.getUpperIdByTableId(tableId, includeInactiveResource)).baseId;
    return this.getPermissionByBaseId(baseId, includeInactiveResource);
  }

  async getPermissionsByResourceId(resourceId: string, includeInactiveResource?: boolean) {
    if (resourceId.startsWith(IdPrefix.Space)) {
      return await this.getPermissionBySpaceId(resourceId);
    } else if (resourceId.startsWith(IdPrefix.Base)) {
      return await this.getPermissionByBaseId(resourceId, includeInactiveResource);
    } else if (resourceId.startsWith(IdPrefix.Table)) {
      return await this.getPermissionByTableId(resourceId, includeInactiveResource);
    } else {
      throw new ForbiddenException('request path is not valid');
    }
  }

  async getPermissions(
    resourceId: string,
    accessTokenId?: string,
    includeInactiveResource?: boolean
  ) {
    const userPermissions = await this.getPermissionsByResourceId(
      resourceId,
      includeInactiveResource
    );

    if (accessTokenId) {
      const accessTokenPermission = await this.getPermissionsByAccessToken(
        resourceId,
        accessTokenId,
        includeInactiveResource
      );
      return intersection(userPermissions, accessTokenPermission);
    }
    return userPermissions;
  }

  async validPermissions(
    resourceId: string,
    permissions: Action[],
    accessTokenId?: string,
    includeInactiveResource?: boolean
  ) {
    const ownPermissions = await this.getPermissions(
      resourceId,
      accessTokenId,
      includeInactiveResource
    );
    if (permissions.every((permission) => ownPermissions.includes(permission))) {
      return ownPermissions;
    }
    throw new ForbiddenException(
      `not allowed to operate ${permissions.join(', ')} on ${resourceId}`
    );
  }
}
