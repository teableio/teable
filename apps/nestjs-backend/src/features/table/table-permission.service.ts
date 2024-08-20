import { Injectable, NotFoundException } from '@nestjs/common';
import type { IBaseRole, ExcludeAction, IRole, TableAction } from '@teable/core';
import { ActionPrefix, actionPrefixMap, getPermissionMap } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

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
    const base = await this.prismaService
      .txClient()
      .base.findUniqueOrThrow({
        where: { id: baseId },
      })
      .catch(() => {
        throw new NotFoundException('Base not found');
      });
    const collaborator = await this.prismaService
      .txClient()
      .collaborator.findFirstOrThrow({
        where: {
          userId,
          resourceId: { in: [baseId, base.spaceId] },
        },
      })
      .catch(() => {
        throw new NotFoundException('Collaborator not found');
      });
    const roleName = collaborator.roleName;
    return this.getTablePermissionMapByRole(baseId, roleName as IBaseRole, tableIds);
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
