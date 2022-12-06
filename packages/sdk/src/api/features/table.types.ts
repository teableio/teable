import type { UnPromisify } from '@teable-group/ts-utils';
import type { TableQuery } from './table.query';

export interface ISearchPoemsParams {
  limit?: number;
  offset?: number;
}

export type ITableData = UnPromisify<ReturnType<TableQuery['execute']>>;
