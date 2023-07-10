import type { IFilter } from '../models';
import type { IdPrefix } from '../utils';

export interface IFieldSnapshotQuery {
  viewId?: string;
}

export interface IAggregateQuery {
  rowCount?: boolean;
  average?: {
    [fieldId: string]: boolean;
  };
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
  aggregate?: IAggregateQuery;
  offset?: number;
  limit?: number;
}

export interface IAggregateQueryResult {
  rowCount?: number;
  average?: {
    [fieldId: string]: number;
  };
}
