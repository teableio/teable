import { ForbiddenException, NotFoundException, Injectable } from '@nestjs/common';
import type { IBaseRole, Action } from '@teable/core';
import { IdPrefix, getPermissions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType } from '@teable/openapi';
import { intersection, union } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { getMaxLevelRole } from '../../utils/get-max-level-role';
import { CollaboratorModel } from '../model/collaborator';

@Injectable()
export class PermissionService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly collaboratorModel: CollaboratorModel
  ) {}

  private getDepartmentIds() {
    const departments = this.cls.get('organization.departments');
    return departments?.map((department) => department.id) || [];
  }

  async getSpaceCollaborators(spaceId: string, principalId: string[]) {
    const collaborators = await this.collaboratorModel.getCollaboratorRawByResourceId(spaceId);
    return collaborators.filter((collaborator) => principalId.includes(collaborator.principalId));
  }

  async getBaseCollaborators(baseId: string, principalId: string[]) {
    const collaborators = await this.collaboratorModel.getCollaboratorRawByResourceId(baseId);
    return collaborators.filter((collaborator) => principalId.includes(collaborator.principalId));
  }

  async getRoleBySpaceId(spaceId: string, includeInactiveResource?: boolean) {
    const userId = this.cls.get('user.id');
    const departmentIds = this.getDepartmentIds();
    const collaborators = await this.getSpaceCollaborators(spaceId, [...departmentIds, userId]);
    const space = await this.prismaService.space.findFirst({
      where: {
        id: spaceId,
      },
    });
    if (!space) {
      throw new ForbiddenException(`space ${spaceId} is not found`);
    }
    if (space?.deletedTime && !includeInactiveResource) {
      throw new ForbiddenException(`space ${spaceId} is deleted`);
    }
    if (!collaborators.length) {
      return null;
    }
    return getMaxLevelRole(collaborators);
  }

  async getRoleByBaseId(baseId: string) {
    const departmentIds = this.getDepartmentIds();
    const userId = this.cls.get('user.id');

    const collaborators = await this.getBaseCollaborators(baseId, [...departmentIds, userId]);
    if (!collaborators.length) {
      return null;
    }
    return getMaxLevelRole(collaborators) as IBaseRole;
  }

  async getOAuthAccessBy(userId: string) {
    const departmentIds = this.getDepartmentIds();
    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        principalId: { in: [...departmentIds, userId] },
      },
      select: { roleName: true, resourceId: true, resourceType: true },
    });

    const spaceIds: string[] = [];
    const baseIds: string[] = [];
    collaborators.forEach(({ resourceId, resourceType }) => {
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
      hasFullAccess,
    } = await this.prismaService.accessToken.findFirstOrThrow({
      where: { id: accessTokenId },
      select: {
        scopes: true,
        spaceIds: true,
        baseIds: true,
        clientId: true,
        userId: true,
        hasFullAccess: true,
      },
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
      hasFullAccess: hasFullAccess ?? undefined,
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
    const { scopes, spaceIds, baseIds, hasFullAccess } = await this.getAccessToken(accessTokenId);

    if (hasFullAccess) {
      return scopes;
    }

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

  private async getPermissionBySpaceId(spaceId: string, includeInactiveResource?: boolean) {
    const role = await this.getRoleBySpaceId(spaceId, includeInactiveResource);
    if (!role) {
      throw new ForbiddenException(`you have no permission to access this space`);
    }
    return getPermissions(role);
  }

  private async getPermissionByBaseId(baseId: string, includeInactiveResource?: boolean) {
    const tempAuthBaseId = this.cls.get('tempAuthBaseId');
    if (tempAuthBaseId === baseId) {
      return getPermissions('owner');
    }
    const role = await this.getRoleByBaseId(baseId);
    const spaceRole = await this.getRoleBySpaceId(
      (await this.getUpperIdByBaseId(baseId, includeInactiveResource)).spaceId,
      includeInactiveResource
    );
    if (!role && !spaceRole) {
      throw new ForbiddenException(`you have no permission to access this base`);
    }
    const basePermissions = role ? getPermissions(role) : [];
    const spacePermissions = spaceRole ? getPermissions(spaceRole) : [];
    // In the presence of an organization, a user can have concurrent permissions at both space and base levels,
    // requiring a merge operation to determine the highest applicable permission level
    return union(basePermissions, spacePermissions);
  }

  private async getPermissionByTableId(tableId: string, includeInactiveResource?: boolean) {
    const baseId = (await this.getUpperIdByTableId(tableId, includeInactiveResource)).baseId;
    return this.getPermissionByBaseId(baseId, includeInactiveResource);
  }

  async getPermissionsByResourceId(resourceId: string, includeInactiveResource?: boolean) {
    if (resourceId.startsWith(IdPrefix.Space)) {
      return await this.getPermissionBySpaceId(resourceId, includeInactiveResource);
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
