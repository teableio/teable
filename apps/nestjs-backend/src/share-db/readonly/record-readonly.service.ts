import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { DataPrismaService } from '@teable/db-data-prisma';
import type { IGetRecordsRo } from '@teable/openapi';
import { IS_TEMPLATE_HEADER, BASE_SHARE_ID_HEADER } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { DATA_KNEX } from '../../global/knex/knex.module';
import type { IShareDbReadonlyAdapterService, RawOpType } from '../interface';
import { ReadonlyService } from './readonly.service';
import type { IReadonlyServiceContext } from './types';

@Injectable()
export class RecordReadonlyServiceAdapter
  extends ReadonlyService
  implements IShareDbReadonlyAdapterService
{
  constructor(
    private readonly cls: ClsService<IReadonlyServiceContext>,
    private readonly prismaService: PrismaService,
    private readonly dataPrismaService: DataPrismaService,
    @InjectModel(DATA_KNEX) private readonly knex: Knex
  ) {
    super(cls);
  }

  getDocIdsByQuery(tableId: string, query: IGetRecordsRo = {}) {
    const shareId = this.cls.get('shareViewId');
    const baseShareId = this.cls.get('baseShareId');
    const useShareViewEndpoint = shareId && !baseShareId;
    const templateHeader = this.cls.get('templateHeader');
    const url = useShareViewEndpoint
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
            [IS_TEMPLATE_HEADER]: templateHeader,
            [BASE_SHARE_ID_HEADER]: baseShareId,
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
    const baseShareId = this.cls.get('baseShareId');
    const useShareViewEndpoint = shareId && !baseShareId;
    const templateHeader = this.cls.get('templateHeader');
    const url = useShareViewEndpoint
      ? `/share/${shareId}/socket/record/snapshot-bulk`
      : `/table/${tableId}/record/socket/snapshot-bulk`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
          [IS_TEMPLATE_HEADER]: templateHeader,
          [BASE_SHARE_ID_HEADER]: baseShareId,
        },
        params: {
          ids: recordIds,
          projection,
        },
      })
      .then((res) => res.data);
  }

  private async validateTable(tableId: string) {
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
    return table;
  }

  async getVersionAndType(tableId: string, recordId: string) {
    const table = await this.validateTable(tableId);
    return this.dataPrismaService
      .txClient()
      .$queryRawUnsafe<
        { version: number; deletedTime: Date | null }[]
      >(this.knex(table.dbTableName).select('__version as version').where('__id', recordId).toQuery())
      .then((res) => {
        return this.formatVersionAndType(res[0]);
      });
  }

  async getVersionAndTypeMap(tableId: string, recordIds: string[]) {
    const table = await this.validateTable(tableId);
    const nativeQuery = this.knex(table.dbTableName)
      .select('__version as version', '__id')
      .whereIn('__id', recordIds)
      .toQuery();
    const recordRaw = await this.dataPrismaService
      .txClient()
      .$queryRawUnsafe<{ version: number; deletedTime: Date | null; __id: string }[]>(nativeQuery);
    return recordRaw.reduce(
      (acc, record) => {
        acc[record.__id] = this.formatVersionAndType(record);
        return acc;
      },
      {} as Record<string, { version: number; type: RawOpType }>
    );
  }
}
