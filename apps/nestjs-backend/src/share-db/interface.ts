import type { Knex } from 'knex';
import type { DB } from 'sharedb';

export interface IShareDbConfig {
  db: DB;
}

export interface ISnapshotQuery {
  viewId: string;
  type?: 'field';
  where?: Knex.DbRecord<unknown>;
  orderBy?: {
    column: string;
    order?: 'asc' | 'desc';
    nulls?: 'first' | 'last';
  }[];
  offset?: number;
  limit?: number;
  idOnly?: boolean;
}
