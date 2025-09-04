import { isEmpty } from 'lodash';
import type {
  IFieldLoaderItem,
  ITableLoaderItem,
  IViewLoaderItem,
} from '../../../types/data-loader';

type IDataLoaderDataItem = IViewLoaderItem | ITableLoaderItem | IFieldLoaderItem;

interface ITableCommonLoaderArgs<T extends IDataLoaderDataItem> {
  filterDataByParentId: (parentId: string) => T[];
  getLoaderData: () =>
    | {
        fullParentIds?: string[];
        dataMap: Map<string, T>;
      }
    | undefined;
  setLoaderData: ({
    fullParentIds,
    dataMap,
  }: {
    fullParentIds?: string[];
    dataMap: Map<string, T>;
  }) => void;
  findManyByParentId: <K extends keyof T>(
    parentId: string,
    keys?: Partial<Record<K, T[K][]>>
  ) => Promise<T[]>;
  findByIds: (ids: string[]) => Promise<T[]>;
  clear: () => void;
  isEnable?: () => boolean | undefined;
}

export class TableCommonLoader<T extends IDataLoaderDataItem> {
  private readonly filterDataByParentId: ITableCommonLoaderArgs<T>['filterDataByParentId'];
  private readonly getLoaderData: ITableCommonLoaderArgs<T>['getLoaderData'];
  private readonly setLoaderData: ITableCommonLoaderArgs<T>['setLoaderData'];
  private readonly findManyByParentId: ITableCommonLoaderArgs<T>['findManyByParentId'];
  private readonly findByIds: ITableCommonLoaderArgs<T>['findByIds'];
  readonly clear: ITableCommonLoaderArgs<T>['clear'];
  readonly isEnable: ITableCommonLoaderArgs<T>['isEnable'];

  constructor({
    filterDataByParentId,
    getLoaderData,
    setLoaderData,
    findManyByParentId,
    findByIds,
    clear,
    isEnable,
  }: ITableCommonLoaderArgs<T>) {
    this.filterDataByParentId = filterDataByParentId;
    this.getLoaderData = getLoaderData;
    this.setLoaderData = setLoaderData;
    this.findManyByParentId = findManyByParentId;
    this.findByIds = findByIds;
    this.clear = clear;
    this.isEnable = isEnable;
  }

  private async sortByOrder(dataArray: T[]) {
    if (!dataArray.length) {
      return [];
    }
    return dataArray.sort((a, b) => a.order - b.order);
  }

  private async getData(parentId: string) {
    const { fullParentIds, dataMap = new Map() } = this.getLoaderData() ?? {};
    if (fullParentIds?.includes(parentId)) {
      return this.sortByOrder(this.filterDataByParentId(parentId));
    }

    const newData = await this.findManyByParentId(parentId);

    newData.forEach((item) => {
      dataMap.set(item.id, item);
    });

    this.setLoaderData({
      dataMap,
      fullParentIds: [...(fullParentIds ?? []), parentId],
    });
    return this.sortByOrder(newData);
  }

  private filterByKeys<K extends keyof T>(data: T[], keys?: Partial<Record<K, T[K][]>>) {
    if (isEmpty(keys)) {
      return data;
    }

    return data.filter((item) => {
      return Object.entries(keys).every(([key, values]) => {
        if (values && (values as T[K][]).length === 0) {
          return false;
        }
        return (values as T[K][])?.includes(item[key as K]);
      });
    });
  }

  async load<K extends keyof T>(parentId: string, keys?: Partial<Record<K, T[K][]>>): Promise<T[]> {
    if (!this.isEnable?.()) {
      return this.findManyByParentId(parentId, keys);
    }
    const data = await this.getData(parentId);
    return this.filterByKeys(data, keys);
  }

  async loadByIds(ids: string[]): Promise<T[]> {
    if (!this.isEnable?.()) {
      return this.findByIds(ids);
    }
    const loaderData = this.getLoaderData();
    const { dataMap = new Map() } = loaderData ?? {};

    const cachedData: T[] = [];
    const notCachedDataIds: string[] = [];
    ids.forEach((id) => {
      const data = dataMap.get(id);
      if (data) {
        cachedData.push(data);
      } else {
        notCachedDataIds.push(id);
      }
    });
    if (notCachedDataIds.length) {
      const newData = await this.findByIds(notCachedDataIds);
      newData.forEach((data) => {
        dataMap.set(data.id, data);
      });
      this.setLoaderData({
        ...loaderData,
        dataMap,
      });
      return ids.map((id) => dataMap.get(id)).filter(Boolean) as T[];
    }
    return cachedData;
  }
}
