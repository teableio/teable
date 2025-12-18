import { Injectable } from '@nestjs/common';
import type { Action, ExcludeAction, TableAction } from '@teable/core';
import {
  ActionPrefix,
  actionPrefixMap,
  getPermissionMap,
  HttpErrorCode,
  TemplateRolePermission,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
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
    if (this.cls.get('template')) {
      return this.getTablePermissionMapByPermissions(baseId, TemplateRolePermission, tableIds);
    }
    const userId = this.cls.get('user.id');
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    const base = await this.prismaService
      .txClient()
      .base.findUniqueOrThrow({
        where: { id: baseId },
      })
      .catch(() => {
        throw new CustomHttpException('Base not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.base.notFound',
          },
        });
      });
    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        principalId: { in: [userId, ...(departmentIds || [])] },
        resourceId: { in: [baseId, base.spaceId] },
      },
    });
    if (collaborators.length === 0) {
      throw new CustomHttpException('Collaborator not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.collaborator.notFound',
        },
      });
    }
    const roleName = getMaxLevelRole(collaborators);
    return this.getTablePermissionMapByPermissions(baseId, getPermissionMap(roleName), tableIds);
  }

  private async getTablePermissionMapByPermissions(
    baseId: string,
    permissions: Record<Action, boolean>,
    tableIds?: string[]
  ) {
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { baseId, deletedTime: null, id: { in: tableIds } },
    });
    return tables.reduce(
      (acc, table) => {
        acc[table.id] = pick(
          permissions,
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
