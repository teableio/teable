import { BadRequestException, Injectable } from '@nestjs/common';
import type { IGetFieldsQuery } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { createViewVoByRaw } from '../view/model/factory';

@Injectable()
export class FieldPermissionService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService
  ) {}

  async getFieldsQueryWithPermission(tableId: string, fieldsQuery: IGetFieldsQuery) {
    const shareViewId = this.cls.get('shareViewId');
    if (shareViewId) {
      return this.getFieldsQueryWithSharePermission(tableId, fieldsQuery);
    }
    return fieldsQuery;
  }

  private async getFieldsQueryWithSharePermission(tableId: string, fieldsQuery: IGetFieldsQuery) {
    const { viewId } = fieldsQuery;
    const shareViewId = this.cls.get('shareViewId');
    const view = await this.prismaService.txClient().view.findFirst({
      where: {
        tableId,
        shareId: shareViewId,
        ...(viewId ? { id: viewId } : {}),
        enableShare: true,
        deletedTime: null,
      },
    });
    if (!view) {
      throw new BadRequestException('error shareId');
    }
    const filterHidden = !createViewVoByRaw(view).shareMeta?.includeHiddenField;
    return { ...fieldsQuery, viewId: view.id, filterHidden };
  }
}
