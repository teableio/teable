/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import type { ITableLoaderData, ITableLoaderItem } from '../../../types/data-loader';
import { TableCommonLoader } from './table-common-loader';

@Injectable()
export class TableLoaderService extends TableCommonLoader<ITableLoaderItem> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {
    super({
      filterDataByParentId: (baseId: string) => this.filterTablesByParentId(baseId),
      getLoaderData: () => this.cls.get('dataLoaderCache.tableData'),
      setLoaderData: (data: ITableLoaderData) => this.cls.set('dataLoaderCache.tableData', data),
      findManyByParentId: <K extends keyof ITableLoaderItem>(
        baseId: string,
        keys?: Partial<Record<K, ITableLoaderItem[K][]>>
      ) =>
        this.prismaService.txClient().tableMeta.findMany({
          where: { baseId, deletedTime: null },
          ...(keys
            ? Object.keys(keys).reduce(
                (acc, kStr) => {
                  const key = kStr as K;
                  const value = keys[key];
                  if (value && value.length > 0) {
                    if (value.length === 1) {
                      acc[key] = value[0];
                    } else {
                      acc[key] = { in: value };
                    }
                  }
                  return acc;
                },
                {} as Partial<Record<K, ITableLoaderItem[K] | { in: ITableLoaderItem[K][] }>>
              )
            : {}),
        }),
      findByIds: (tableIds: string[]) =>
        this.prismaService
          .txClient()
          .tableMeta.findMany({ where: { id: { in: tableIds }, deletedTime: null } }),
      clear: () => this.cls.set('dataLoaderCache.tableData', undefined),
      isEnable: () => cls.get('dataLoaderCache.cacheKeys')?.includes('table'),
    });
  }

  private filterTablesByParentId(baseId: string) {
    const tableMap = this.cls.get('dataLoaderCache.tableData.dataMap');
    if (!tableMap?.size) {
      return [];
    }
    return Array.from(tableMap.values()).filter((table) => table.baseId === baseId);
  }
}
