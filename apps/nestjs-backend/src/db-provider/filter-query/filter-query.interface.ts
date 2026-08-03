import type { Knex } from 'knex';

export interface IFilterQueryInterface {
  appendQueryBuilder(): Knex.QueryBuilder;
}
