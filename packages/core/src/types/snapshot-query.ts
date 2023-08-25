import type { IFilter, ISort } from '../models';
import type { IdPrefix } from '../utils';

export interface IFieldSnapshotQuery {
  viewId?: string;
}

export interface IRecordSnapshotQuery {
  viewId?: string;
  type: IdPrefix.Record;
  filter?: IFilter;
  orderBy?: ISort['sortObjs'];
  offset?: number;
  limit?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  where?: any;
}

export interface IExtraResult {
  [key: string]: unknown;
}
