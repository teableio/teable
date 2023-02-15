export enum SnapshotQueryType {
  Field = 'field',
  Record = 'record',
  RowCount = 'rowCount',
}

export interface IFieldSnapshotQuery {
  viewId: string;
  type: SnapshotQueryType.Field;
}

export interface IRowCountQuery {
  viewId: string;
  type: SnapshotQueryType.RowCount;
}

export interface IRecordSnapshotQuery {
  viewId: string;
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
