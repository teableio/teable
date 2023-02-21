import type { AggregateKey } from '../random';

export enum SnapshotQueryType {
  Field = 'field',
  Record = 'record',
  View = 'view',
  Table = 'table',
  Aggregate = 'aggregate',
}

export interface ITableSnapshotQuery {
  type: SnapshotQueryType.Table;
}

export interface IFieldSnapshotQuery {
  viewId?: string;
  type: SnapshotQueryType.Field;
}

export interface IAggregateQuery {
  viewId?: string;
  type: SnapshotQueryType.Aggregate;
  aggregateKey: AggregateKey;
}

export interface IViewSnapshotQuery {
  type: SnapshotQueryType.View;
}

export interface IRecordSnapshotQuery {
  viewId?: string;
  type?: SnapshotQueryType.Record;
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
