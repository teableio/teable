import { Injectable, NotFoundException } from '@nestjs/common';
import type { ExcludeAction, IRole, TableAction } from '@teable/core';
import { ActionPrefix, actionPrefixMap, getPermissionMap } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { getMaxLevelRole } from '../../utils/get-max-level-role';

@Injectable()
export class TablePermissionService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService
  ) {}

  async getProjectionTableIds(_baseId: string): Promise<string[] | undefined> {
    const shareViewId = this.cls.get('shareViewId');
    if (shareViewId) {
      return this.getViewQueryWithSharePermission();
    }
  }

  protected async getViewQueryWithSharePermission() {
    return [];
  }

  async getTablePermissionMapByBaseId(
    baseId: string,
    tableIds?: string[]
  ): Promise<Record<string, Record<ExcludeAction<TableAction, 'table|create'>, boolean>>> {
    const userId = this.cls.get('user.id');
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    const base = await this.prismaService
      .txClient()
      .base.findUniqueOrThrow({
        where: { id: baseId },
      })
      .catch(() => {
        throw new NotFoundException('Base not found');
      });
    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        principalId: { in: [userId, ...(departmentIds || [])] },
        resourceId: { in: [baseId, base.spaceId] },
      },
    });
    if (collaborators.length === 0) {
      throw new NotFoundException('Collaborator not found');
    }
    const roleName = getMaxLevelRole(collaborators);
    return this.getTablePermissionMapByRole(baseId, roleName, tableIds);
  }

  async getTablePermissionMapByRole(baseId: string, roleName: IRole, tableIds?: string[]) {
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { baseId, deletedTime: null, id: { in: tableIds } },
    });
    return tables.reduce(
      (acc, table) => {
        acc[table.id] = pick(
          getPermissionMap(roleName),
          actionPrefixMap[ActionPrefix.Table].filter(
            (action) => action !== 'table|create'
          ) as ExcludeAction<TableAction, 'table|create'>[]
        );
        return acc;
      },
      {} as Record<string, Record<ExcludeAction<TableAction, 'table|create'>, boolean>>
    );
  }
}
