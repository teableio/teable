/* eslint-disable sonarjs/no-duplicate-string */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IResetTrashItemsRo,
  IResourceMapVo,
  ITrashItemsRo,
  ITrashItemVo,
  ITrashRo,
  ITrashVo,
} from '@teable/openapi';
import { CollaboratorType, ResourceType } from '@teable/openapi';
import { keyBy } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from '../auth/permission.service';
import { TableOpenApiService } from '../table/open-api/table-open-api.service';
import { UserService } from '../user/user.service';

@Injectable()
export class TrashService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
    private readonly tableOpenApiService: TableOpenApiService
  ) {}

  async getAuthorizedSpacesAndBases() {
    const userId = this.cls.get('user.id');
    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        userId,
        roleName: { in: [Role.Owner, Role.Creator] },
      },
      select: {
        resourceId: true,
        resourceType: true,
      },
    });

    const baseIds = new Set<string>();
    const spaceIds = new Set<string>();

    collaborators.forEach(({ resourceId, resourceType }) => {
      if (resourceType === CollaboratorType.Base) baseIds.add(resourceId);
      if (resourceType === CollaboratorType.Space) spaceIds.add(resourceId);
    });
    const bases = await this.prismaService.base.findMany({
      where: {
        OR: [{ spaceId: { in: Array.from(spaceIds) } }, { id: { in: Array.from(baseIds) } }],
      },
      select: {
        id: true,
        name: true,
        spaceId: true,
        space: {
          select: {
            name: true,
          },
        },
      },
    });
    const spaces = await this.prismaService.space.findMany({
      where: { id: { in: Array.from(spaceIds) } },
      select: { id: true, name: true },
    });

    return {
      spaces,
      bases,
    };
  }

  async getTrash(trashRo: ITrashRo) {
    const { resourceType } = trashRo;

    switch (resourceType) {
      case ResourceType.Space:
        return await this.getSpaceTrash();
      case ResourceType.Base:
        return await this.getBaseTrash();
      default:
        throw new BadRequestException('Invalid resource type');
    }
  }

  private async getSpaceTrash() {
    const { spaces } = await this.getAuthorizedSpacesAndBases();
    const spaceIds = spaces.map((space) => space.id);
    const spaceIdMap = keyBy(spaces, 'id');
    const list = await this.prismaService.trash.findMany({
      where: { resourceId: { in: spaceIds } },
      orderBy: { deletedTime: 'desc' },
    });

    const trashItems: ITrashItemVo[] = [];
    const deletedBySet: Set<string> = new Set();
    const resourceMap: IResourceMapVo = {};

    list.forEach((item) => {
      const { id, resourceId, resourceType, deletedTime, deletedBy } = item;

      trashItems.push({
        id,
        resourceId,
        resourceType: resourceType as ResourceType,
        deletedTime: deletedTime.toISOString(),
        deletedBy,
      });
      resourceMap[resourceId] = {
        id: resourceId,
        name: spaceIdMap[resourceId].name,
      };
      deletedBySet.add(deletedBy);
    });

    const userList = await this.userService.getUserInfoList(Array.from(deletedBySet));

    return {
      trashItems,
      resourceMap,
      userMap: keyBy(userList, 'id'),
      nextCursor: null,
    };
  }

  private async getBaseTrash() {
    const { bases } = await this.getAuthorizedSpacesAndBases();
    const baseIds = bases.map((base) => base.id);
    const spaceIds = bases.map((base) => base.spaceId);
    const baseIdMap = keyBy(bases, 'id');

    const trashedSpaces = await this.prismaService.trash.findMany({
      where: {
        resourceType: ResourceType.Space,
        resourceId: { in: spaceIds },
      },
      select: { resourceId: true },
    });
    const list = await this.prismaService.trash.findMany({
      where: {
        parentId: { notIn: trashedSpaces.map((space) => space.resourceId) },
        resourceId: { in: baseIds },
        resourceType: ResourceType.Base,
      },
    });

    const trashItems: ITrashItemVo[] = [];
    const deletedBySet: Set<string> = new Set();
    const resourceMap: IResourceMapVo = {};

    list.forEach((item) => {
      const { id, resourceId, resourceType, deletedTime, deletedBy } = item;

      trashItems.push({
        id,
        resourceId,
        resourceType: resourceType as ResourceType,
        deletedTime: deletedTime.toISOString(),
        deletedBy,
      });
      deletedBySet.add(deletedBy);

      const baseInfo = baseIdMap[resourceId];
      resourceMap[resourceId] = {
        id: resourceId,
        spaceId: baseInfo.spaceId,
        name: baseInfo.name,
      };
      resourceMap[baseInfo.spaceId] = {
        id: baseInfo.spaceId,
        name: baseInfo.space.name,
      };
    });
    const userList = await this.userService.getUserInfoList(Array.from(deletedBySet));

    return {
      trashItems,
      resourceMap,
      userMap: keyBy(userList, 'id'),
      nextCursor: null,
    };
  }

  async getTrashItems(trashItemsRo: ITrashItemsRo): Promise<ITrashVo> {
    const { resourceId, resourceType } = trashItemsRo;

    if (resourceType !== ResourceType.Base) {
      throw new BadRequestException('Invalid resource type');
    }

    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(
      resourceId,
      ['table|delete'],
      accessTokenId,
      true
    );

    const tables = await this.prismaService.tableMeta.findMany({
      where: {
        baseId: resourceId,
        deletedTime: { not: null },
      },
      select: {
        id: true,
        name: true,
      },
    });
    const tableIdMap = keyBy(tables, 'id');
    const trashItems: ITrashItemVo[] = [];
    const deletedBySet: Set<string> = new Set();
    const resourceMap: IResourceMapVo = {};

    const list = await this.prismaService.trash.findMany({
      where: {
        resourceId: { in: Object.keys(tableIdMap) },
        resourceType: ResourceType.Table,
      },
      orderBy: { deletedTime: 'desc' },
    });

    list.forEach((item) => {
      const { id, resourceId, resourceType, deletedTime, deletedBy } = item;

      trashItems.push({
        id,
        resourceId,
        resourceType: resourceType as ResourceType,
        deletedTime: deletedTime.toISOString(),
        deletedBy,
      });
      deletedBySet.add(deletedBy);
      resourceMap[resourceId] = tableIdMap[resourceId];
    });
    const userList = await this.userService.getUserInfoList(Array.from(deletedBySet));

    return {
      trashItems,
      resourceMap,
      userMap: keyBy(userList, 'id'),
      nextCursor: null,
    };
  }

  async restoreTrash(trashId: string) {
    const accessTokenId = this.cls.get('accessTokenId');

    return await this.prismaService.$tx(async (prisma) => {
      const { resourceId, resourceType } = await prisma.trash
        .findUniqueOrThrow({
          where: { id: trashId },
          select: {
            resourceId: true,
            resourceType: true,
          },
        })
        .catch(() => {
          throw new NotFoundException(`The trash ${trashId} not found`);
        });

      // Restore space
      if (resourceType === ResourceType.Space) {
        await this.permissionService.validPermissions(
          resourceId,
          ['space|create'],
          accessTokenId,
          true
        );

        await prisma.space.update({
          where: { id: resourceId },
          data: { deletedTime: null },
        });

        await prisma.trash.delete({
          where: { id: trashId },
        });
      }

      // Restore base
      if (resourceType === ResourceType.Base) {
        const base = await this.prismaService.base.findUniqueOrThrow({
          where: { id: resourceId },
          select: { id: true, spaceId: true },
        });
        const trashedSpace = await prisma.trash.findFirst({
          where: { resourceId: base.spaceId, resourceType: ResourceType.Space },
        });

        if (trashedSpace != null) {
          throw new ForbiddenException(
            'Unable to restore this base because its parent space is also trashed'
          );
        }

        await this.permissionService.validPermissions(
          resourceId,
          ['base|create'],
          accessTokenId,
          true
        );

        await prisma.base.update({
          where: { id: resourceId },
          data: { deletedTime: null },
        });

        await prisma.trash.delete({
          where: { id: trashId },
        });
      }

      // Restore table
      if (resourceType === ResourceType.Table) {
        const { baseId } = await this.prismaService.tableMeta.findUniqueOrThrow({
          where: { id: resourceId },
          select: { id: true, baseId: true },
        });
        const base = await this.prismaService.base.findUniqueOrThrow({
          where: { id: baseId },
          select: { id: true, spaceId: true },
        });
        const trashedParentResources = await prisma.trash.findMany({
          where: { resourceId: { in: [baseId, base.spaceId] } },
        });

        if (trashedParentResources.length) {
          throw new ForbiddenException(
            'Unable to restore this table because its parent base or space is also trashed'
          );
        }

        await this.permissionService.validPermissions(
          resourceId,
          ['table|create'],
          accessTokenId,
          true
        );

        await this.tableOpenApiService.restoreTable(baseId, resourceId);
      }
    });
  }

  async resetTrashItems(resetTrashItemsRo: IResetTrashItemsRo) {
    const { resourceId, resourceType } = resetTrashItemsRo;

    if (resourceType !== ResourceType.Base) {
      throw new BadRequestException('Invalid resource type');
    }

    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(
      resourceId,
      ['table|delete'],
      accessTokenId,
      true
    );

    const tables = await this.prismaService.tableMeta.findMany({
      where: {
        baseId: resourceId,
        deletedTime: { not: null },
      },
      select: { id: true },
    });

    if (!tables.length) return;

    const tableIds = tables.map(({ id }) => id);
    await this.tableOpenApiService.permanentDeleteTables(resourceId, tableIds);
  }
}
