/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import type { IViewLoaderData, IViewLoaderItem } from '../../../types/data-loader';
import { TableCommonLoader } from './table-common-loader';

@Injectable()
export class ViewLoaderService extends TableCommonLoader<IViewLoaderItem> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {
    super({
      filterDataByParentId: (tableId: string) => this.getViewsInCache(tableId),
      getLoaderData: () => this.cls.get('dataLoaderCache.viewData'),
      setLoaderData: (data: IViewLoaderData) => this.cls.set('dataLoaderCache.viewData', data),
      findManyByParentId: <K extends keyof IViewLoaderItem>(
        tableId: string,
        keys?: Partial<Record<K, IViewLoaderItem[K][]>>
      ) =>
        this.prismaService.txClient().view.findMany({
          where: { tableId, deletedTime: null },
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
                {} as Partial<Record<K, IViewLoaderItem[K] | { in: IViewLoaderItem[K][] }>>
              )
            : {}),
        }),
      findByIds: (viewIds: string[]) =>
        this.prismaService
          .txClient()
          .view.findMany({ where: { id: { in: viewIds }, deletedTime: null } }),
      clear: () => this.cls.set('dataLoaderCache.viewData', undefined),
      isEnable: () => cls.get('dataLoaderCache.cacheKeys')?.includes('view'),
    });
  }

  private getViewsInCache(tableId: string): IViewLoaderItem[] {
    const viewMap = this.cls.get('dataLoaderCache.viewData.dataMap');
    if (!viewMap?.size) {
      return [];
    }
    return Array.from(viewMap.values()).filter((view) => view.tableId === tableId);
  }
}
