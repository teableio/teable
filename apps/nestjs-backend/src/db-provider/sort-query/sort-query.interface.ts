import type { Knex } from 'knex';

export interface ISortQueryInterface {
  appendSortBuilder(): Knex.QueryBuilder;
  getRawSortSQLText(): string;
}
