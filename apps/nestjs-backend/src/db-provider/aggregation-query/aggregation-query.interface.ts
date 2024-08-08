import type { Knex } from 'knex';

export interface IAggregationQueryInterface {
  appendBuilder(): Knex.QueryBuilder;
}
