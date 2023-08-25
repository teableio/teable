import type { IFilter } from '../models';
import type { IdPrefix } from '../utils';

export interface IFieldSnapshotQuery {
  viewId?: string;
}

export interface IRecordSnapshotQuery {
  viewId?: string;
  type: IdPrefix.Record;
  filter?: IFilter;
  orderBy?: {
    column: string; // db column name for queryBuilder
    order?: 'asc' | 'desc';
    nulls?: 'first' | 'last';
  }[];
  offset?: number;
  limit?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  where?: any;
}

export interface IExtraResult {
  [key: string]: unknown;
}
