import type { IFilter, ISort } from '../models';
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
  orderBy?: ISort['sortObjs'];
  aggregate?: IAggregateQuery;
  offset?: number;
  limit?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  where?: any;
}

export interface IAggregateQueryResult {
  rowCount?: number;
  average?: {
    [fieldId: string]: number;
  };
}
