import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { IGetRecordsRo } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import type { IShareDbReadonlyAdapterService } from '../interface';
import { ReadonlyService } from './readonly.service';

@Injectable()
export class RecordReadonlyServiceAdapter
  extends ReadonlyService
  implements IShareDbReadonlyAdapterService
{
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {
    super(cls);
  }

  getDocIdsByQuery(tableId: string, query: IGetRecordsRo = {}) {
    const shareId = this.cls.get('shareViewId');
    const url = shareId
      ? `/share/${shareId}/socket/record/doc-ids`
      : `/table/${tableId}/record/socket/doc-ids`;
    return this.axios
      .post(
        url,
        {
          ...query,
          filter: JSON.stringify(query?.filter),
          orderBy: JSON.stringify(query?.orderBy),
          groupBy: JSON.stringify(query?.groupBy),
          collapsedGroupIds: JSON.stringify(query?.collapsedGroupIds),
        },
        {
          headers: {
            cookie: this.cls.get('cookie'),
          },
        }
      )
      .then((res) => res.data);
  }
  getSnapshotBulk(
    tableId: string,
    recordIds: string[],
    projection?: { [fieldNameOrId: string]: boolean }
  ) {
    const shareId = this.cls.get('shareViewId');
    const url = shareId
      ? `/share/${shareId}/socket/record/snapshot-bulk`
      : `/table/${tableId}/record/socket/snapshot-bulk`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
        },
        params: {
          ids: recordIds,
          projection,
        },
      })
      .then((res) => res.data);
  }

  async getVersionAndType(tableId: string, recordId: string) {
    const table = await this.prismaService.tableMeta.findUnique({
      where: {
        id: tableId,
      },
      select: {
        version: true,
        deletedTime: true,
        dbTableName: true,
      },
    });
    if (!table) {
      throw new NotFoundException('Table not found');
    }
    return this.prismaService
      .$queryRawUnsafe<
        { version: number; deletedTime: Date | null }[]
      >(this.knex(table.dbTableName).select('__version as version').where('__id', recordId).toQuery())
      .then((res) => {
        return this.formatVersionAndType(res[0]);
      });
  }
}
