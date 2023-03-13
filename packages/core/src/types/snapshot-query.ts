import type { AggregateKey, IdPrefix } from '../utils';

export interface IFieldSnapshotQuery {
  viewId?: string;
}

export interface IAggregateQuery {
  viewId?: string;
  type: IdPrefix.Aggregate;
  aggregateKey: AggregateKey;
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
