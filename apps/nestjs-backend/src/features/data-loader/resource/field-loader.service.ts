/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import type { IFieldLoaderData, IFieldLoaderItem } from '../../../types/data-loader';
import { TableCommonLoader } from './table-common-loader';

@Injectable()
export class FieldLoaderService extends TableCommonLoader<IFieldLoaderItem> {
  cacheSet = 0;
  loadCount = 0;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {
    super({
      filterDataByParentId: (tableId: string) => this.getFieldsInCache(tableId),
      getLoaderData: () => this.cls.get('dataLoaderCache.fieldData'),
      setLoaderData: (data: IFieldLoaderData) => this.cls.set('dataLoaderCache.fieldData', data),
      findManyByParentId: <K extends keyof IFieldLoaderItem>(
        tableId: string,
        keys?: Partial<Record<K, IFieldLoaderItem[K][]>>
      ) => {
        this.cacheSet++;
        return this.prismaService.txClient().field.findMany({
          where: {
            tableId,
            deletedTime: null,
            ...(keys
              ? Object.keys(keys).reduce(
                  (acc, kStr) => {
                    const key = kStr as K;
                    const value = keys[key];
                    if (value) {
                      if (value.length === 1) {
                        acc[key] = value[0];
                      } else {
                        acc[key] = { in: value };
                      }
                    }
                    return acc;
                  },
                  {} as Partial<Record<K, IFieldLoaderItem[K] | { in: IFieldLoaderItem[K][] }>>
                )
              : {}),
          },
        });
      },
      findByIds: (fieldIds: string[]) =>
        this.prismaService
          .txClient()
          .field.findMany({ where: { id: { in: fieldIds }, deletedTime: null } })
          .then((fields) => {
            this.cacheSet++;
            return fields;
          }),
      clear: () => this.cls.set('dataLoaderCache.fieldData', undefined),
      isEnable: () => cls.get('dataLoaderCache.cacheKeys')?.includes('field'),
    });
  }

  private getFieldsInCache(tableId: string): IFieldLoaderItem[] {
    const fieldMap = this.cls.get('dataLoaderCache.fieldData.dataMap');
    if (!fieldMap?.size) {
      return [];
    }
    return Array.from(fieldMap.values()).filter((field) => field.tableId === tableId);
  }

  private logStat() {
    if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') {
      return;
    }

    const cacheHits = this.loadCount - this.cacheSet;
    const hitRate = this.loadCount > 0 ? ((cacheHits / this.loadCount) * 100).toFixed(1) : '0.0';

    console.log(
      `[FieldLoader] 📊 loads: ${this.loadCount} | db queries: ${this.cacheSet} | cache hits: ${cacheHits} | hit rate: ${hitRate}%`
    );
  }

  invalidateTables(tableIds: string | string[]) {
    if (!this.cls.isActive() || !this.isEnable?.()) {
      return;
    }

    const ids = (Array.isArray(tableIds) ? tableIds : [tableIds]).filter(Boolean);
    if (!ids.length) {
      return;
    }

    const loaderData = this.cls.get('dataLoaderCache.fieldData');
    if (!loaderData) {
      return;
    }

    const { dataMap, fullParentIds } = loaderData;

    if (fullParentIds?.length) {
      loaderData.fullParentIds = fullParentIds.filter((parentId) => !ids.includes(parentId));
    }

    if (dataMap?.size) {
      const tableIdSet = new Set(ids);
      for (const [fieldId, field] of dataMap.entries()) {
        if (field?.tableId && tableIdSet.has(field.tableId)) {
          dataMap.delete(fieldId);
        }
      }
    }

    this.cls.set('dataLoaderCache.fieldData', loaderData);
  }

  resetStat() {
    this.cacheSet = 0;
    this.loadCount = 0;
  }

  override async load(
    tableId: string,
    keys?: Partial<Record<keyof IFieldLoaderItem, IFieldLoaderItem[keyof IFieldLoaderItem][]>>
  ): Promise<IFieldLoaderItem[]> {
    this.loadCount++;
    const result = await super.load(tableId, keys);
    this.logStat();
    return result;
  }

  override async loadByIds(ids: string[]): Promise<IFieldLoaderItem[]> {
    this.loadCount++;
    const result = await super.loadByIds(ids);
    this.logStat();
    return result;
  }
}
