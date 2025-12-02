import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import type { IShareDbReadonlyAdapterService, RawOpType } from '../interface';
import { ReadonlyService } from './readonly.service';

@Injectable()
export class TableReadonlyServiceAdapter
  extends ReadonlyService
  implements IShareDbReadonlyAdapterService
{
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService
  ) {
    super(cls);
  }

  getDocIdsByQuery(baseId: string) {
    return this.axios
      .get(`/base/${baseId}/table/socket/doc-ids`, {
        headers: {
          cookie: this.cls.get('cookie'),
        },
      })
      .then((res) => res.data);
  }
  getSnapshotBulk(baseId: string, ids: string[]) {
    return this.axios
      .get(`/base/${baseId}/table/socket/snapshot-bulk`, {
        headers: {
          cookie: this.cls.get('cookie'),
        },
        params: {
          ids,
        },
      })
      .then((res) => res.data);
  }

  getVersionAndType(baseId: string, tableId: string) {
    return this.prismaService.tableMeta
      .findUnique({
        where: {
          id: tableId,
          baseId,
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

  getVersionAndTypeMap(baseId: string, tableIds: string[]) {
    return this.prismaService.tableMeta
      .findMany({
        where: {
          id: { in: tableIds },
          baseId,
        },
        select: {
          id: true,
          version: true,
          deletedTime: true,
        },
      })
      .then((tables) => {
        return tables.reduce(
          (acc, table) => {
            acc[table.id] = this.formatVersionAndType(table);
            return acc;
          },
          {} as Record<string, { version: number; type: RawOpType }>
        );
      });
  }
}
