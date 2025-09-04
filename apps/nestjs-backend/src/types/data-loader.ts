import type { Prisma } from '@prisma/client';

export type IFieldLoaderItem = Prisma.$FieldPayload['scalars'];

export interface IFieldLoaderData {
  dataMap?: Map<string, IFieldLoaderItem>;
  fullParentIds?: string[];
}

export type ITableLoaderItem = Prisma.$TableMetaPayload['scalars'];

export interface ITableLoaderData {
  dataMap?: Map<string, ITableLoaderItem>;
  fullParentIds?: string[];
}

export type IViewLoaderItem = Prisma.$ViewPayload['scalars'];

export interface IViewLoaderData {
  dataMap?: Map<string, IViewLoaderItem>;
  fullParentIds?: string[];
}

export interface IDataLoaderCache {
  tableData?: ITableLoaderData;
  fieldData?: IFieldLoaderData;
  viewData?: IViewLoaderData;
  cacheKeys?: ('table' | 'field' | 'view')[];
}
