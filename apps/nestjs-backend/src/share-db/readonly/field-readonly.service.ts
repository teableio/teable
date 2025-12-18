import { Injectable } from '@nestjs/common';
import type { IGetFieldsQuery } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { IS_TEMPLATE_HEADER } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { RawOpType, IShareDbReadonlyAdapterService } from '../interface';
import { ReadonlyService } from './readonly.service';
import type { IReadonlyServiceContext } from './types';

@Injectable()
export class FieldReadonlyServiceAdapter
  extends ReadonlyService
  implements IShareDbReadonlyAdapterService
{
  constructor(
    private readonly cls: ClsService<IReadonlyServiceContext>,
    private readonly prismaService: PrismaService
  ) {
    super(cls);
  }

  getDocIdsByQuery(tableId: string, query: IGetFieldsQuery = {}) {
    const shareId = this.cls.get('shareViewId');
    const templateHeader = this.cls.get('templateHeader');
    const url = shareId
      ? `/share/${shareId}/socket/field/doc-ids`
      : `/table/${tableId}/field/socket/doc-ids`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
          [IS_TEMPLATE_HEADER]: templateHeader,
        },
        params: query,
      })
      .then((res) => res.data);
  }
  getSnapshotBulk(tableId: string, ids: string[]) {
    const shareId = this.cls.get('shareViewId');
    const templateHeader = this.cls.get('templateHeader');
    const url = shareId
      ? `/share/${shareId}/socket/field/snapshot-bulk`
      : `/table/${tableId}/field/socket/snapshot-bulk`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
          [IS_TEMPLATE_HEADER]: templateHeader,
        },
        params: {
          ids,
        },
      })
      .then((res) => res.data);
  }

  getVersionAndType(tableId: string, fieldId: string) {
    return this.prismaService.field
      .findUnique({
        where: {
          id: fieldId,
          tableId,
        },
        select: {
          version: true,
          deletedTime: true,
        },
      })
      .then((res) => {
        return this.formatVersionAndType(res);
      });
  }

  getVersionAndTypeMap(tableId: string, fieldIds: string[]) {
    return this.prismaService.field
      .findMany({
        where: {
          id: { in: fieldIds },
          tableId,
        },
        select: {
          id: true,
          version: true,
          deletedTime: true,
        },
      })
      .then((fields) => {
        return fields.reduce(
          (acc, field) => {
            acc[field.id] = this.formatVersionAndType(field);
            return acc;
          },
          {} as Record<string, { version: number; type: RawOpType }>
        );
      });
  }
}
