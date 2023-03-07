import type { AggregateKey, IdPrefix } from '../utils';

export interface ITableSnapshotQuery {
  type: IdPrefix.Table;
}

export interface IFieldSnapshotQuery {
  viewId?: string;
  type: IdPrefix.Field;
}

export interface IAggregateQuery {
  viewId?: string;
  type: IdPrefix.Aggregate;
  aggregateKey: AggregateKey;
}

export interface IViewSnapshotQuery {
  type: IdPrefix.View;
}

export interface IRecordSnapshotQuery {
  viewId?: string;
  type: IdPrefix.Record;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  where?: any;
  orderBy?: {
    column: string;
    order?: 'asc' | 'desc';
    nulls?: 'first' | 'last';
  }[];
  offset?: number;
  limit?: number;
}

export type ISnapshotQuery =
  | IAggregateQuery
  | IViewSnapshotQuery
  | IRecordSnapshotQuery
  | IFieldSnapshotQuery
  | ITableSnapshotQuery;
