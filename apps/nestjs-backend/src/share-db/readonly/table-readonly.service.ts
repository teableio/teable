import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { IS_TEMPLATE_HEADER } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IShareDbReadonlyAdapterService, RawOpType } from '../interface';
import { ReadonlyService } from './readonly.service';
import type { IReadonlyServiceContext } from './types';

@Injectable()
export class TableReadonlyServiceAdapter
  extends ReadonlyService
  implements IShareDbReadonlyAdapterService
{
  constructor(
    private readonly cls: ClsService<IReadonlyServiceContext>,
    private readonly prismaService: PrismaService
  ) {
    super(cls);
  }

  getDocIdsByQuery(baseId: string) {
    const templateHeader = this.cls.get('templateHeader');
    return this.axios
      .get(`/base/${baseId}/table/socket/doc-ids`, {
        headers: {
          cookie: this.cls.get('cookie'),
          [IS_TEMPLATE_HEADER]: templateHeader,
        },
      })
      .then((res) => res.data);
  }
  getSnapshotBulk(baseId: string, ids: string[]) {
    const templateHeader = this.cls.get('templateHeader');
    return this.axios
      .get(`/base/${baseId}/table/socket/snapshot-bulk`, {
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
