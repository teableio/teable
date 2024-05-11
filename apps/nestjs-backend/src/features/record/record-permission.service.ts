import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FieldKeyType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IGetRecordsRo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { isNotHiddenField } from '../../utils/is-not-hidden-field';
import { createViewVoByRaw } from '../view/model/factory';

@Injectable()
export class RecordPermissionService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService
  ) {}

  async getRecordQueryWithPermission(tableId: string, recordQuery: IGetRecordsRo) {
    const shareViewId = this.cls.get('shareViewId');
    if (shareViewId) {
      return this.getRecordQueryWithSharePermission(tableId, recordQuery);
    }
    return recordQuery;
  }

  protected async getRecordQueryWithSharePermission(tableId: string, recordQuery: IGetRecordsRo) {
    const { viewId } = recordQuery;
    const viewIdWithShare = await this.getViewIdByShare(tableId, viewId);
    return {
      ...recordQuery,
      viewId: viewIdWithShare,
    };
  }

  protected async getViewIdByShare(tableId: string, viewId?: string) {
    const shareId = this.cls.get('shareViewId');
    if (!shareId) {
      return viewId;
    }
    const view = await this.prismaService.txClient().view.findFirst({
      select: { id: true },
      where: {
        tableId,
        shareId,
        ...(viewId ? { id: viewId } : {}),
        enableShare: true,
        deletedTime: null,
      },
    });
    if (!view) {
      throw new BadRequestException('error shareId');
    }
    return view.id;
  }

  async getProjectionWithPermission(
    tableId: string,
    fieldKeyType: FieldKeyType,
    projection?: { [fieldNameOrId: string]: boolean }
  ) {
    const shareViewId = this.cls.get('shareViewId');
    if (shareViewId) {
      return this.getProjectionWithSharePermission(tableId, fieldKeyType, projection);
    }
    return projection;
  }

  protected async getProjectionWithSharePermission(
    tableId: string,
    fieldKeyType: FieldKeyType,
    projection?: { [fieldNameOrId: string]: boolean }
  ) {
    const shareId = this.cls.get('shareViewId');
    const projectionInner = projection || {};
    if (shareId) {
      const rawView = await this.prismaService.txClient().view.findFirst({
        where: { shareId: shareId, enableShare: true, deletedTime: null },
      });

      if (!rawView) {
        throw new NotFoundException('error shareId');
      }

      const view = createViewVoByRaw(rawView);

      const fields = await this.prismaService.txClient().field.findMany({
        where: { tableId, deletedTime: null },
        select: {
          id: true,
          name: true,
        },
      });

      if (!view?.shareMeta?.includeHiddenField) {
        fields
          .filter((field) => isNotHiddenField(field.id, view))
          .forEach((field) => (projectionInner[field[fieldKeyType]] = true));
      }
    }
    return Object.keys(projectionInner).length ? projectionInner : undefined;
  }

  async hasUpdateRecordPermission(_tableId: string, _recordId: string) {
    const shareViewId = this.cls.get('shareViewId');
    if (shareViewId) {
      return false;
    }
    return true;
  }

  async hasUpdateRecordPermissionOrThrow(tableId: string, recordId: string) {
    if (!(await this.hasUpdateRecordPermission(tableId, recordId))) {
      throw new ForbiddenException(`no has update ${recordId} permission`);
    }
  }

  async getDeniedReadRecordsPermission(_tableId: string, _recordIds: string[]): Promise<string[]> {
    return [];
  }
}
