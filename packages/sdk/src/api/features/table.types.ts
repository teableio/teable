import type { IUnPromisify } from '@teable-group/core';
import type { TableQuery } from './table.query';

export interface ISearchPoemsParams {
  limit?: number;
  offset?: number;
}

export type ITableData = IUnPromisify<ReturnType<TableQuery['execute']>>;
