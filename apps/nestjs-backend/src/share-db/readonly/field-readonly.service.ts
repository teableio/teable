import { Injectable, NotFoundException } from '@nestjs/common';
import type { IGetFieldsQuery } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import type { IShareDbReadonlyAdapterService } from '../interface';
import { ReadonlyService } from './readonly.service';

@Injectable()
export class FieldReadonlyServiceAdapter
  extends ReadonlyService
  implements IShareDbReadonlyAdapterService
{
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService
  ) {
    super(cls);
  }

  getDocIdsByQuery(tableId: string, query: IGetFieldsQuery = {}) {
    const shareId = this.cls.get('shareViewId');
    const url = shareId
      ? `/share/${shareId}/socket/field/doc-ids`
      : `/table/${tableId}/field/socket/doc-ids`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
        },
        params: query,
      })
      .then((res) => res.data);
  }
  getSnapshotBulk(tableId: string, ids: string[]) {
    const shareId = this.cls.get('shareViewId');
    const url = shareId
      ? `/share/${shareId}/socket/field/snapshot-bulk`
      : `/table/${tableId}/field/socket/snapshot-bulk`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
        },
        params: {
          ids,
        },
      })
      .then((res) => res.data);
  }

  getVersion(tableId: string, fieldId: string) {
    return this.prismaService.field
      .findUnique({
        where: {
          id: fieldId,
        },
        select: {
          version: true,
          deletedTime: true,
        },
      })
      .then((res) => {
        if (!res) {
          throw new NotFoundException(`Field(id: ${fieldId}) not found in table(id: ${tableId})`);
        }
        if (res.deletedTime) {
          return 0;
        }
        return res.version;
      });
  }
}
