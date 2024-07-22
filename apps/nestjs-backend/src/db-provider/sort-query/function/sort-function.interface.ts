import type { Knex } from 'knex';

export type ISortFunctionHandler = (builderClient: Knex.QueryBuilder) => Knex.QueryBuilder;

export interface ISortFunctionInterface {
  asc: ISortFunctionHandler;
  desc: ISortFunctionHandler;
  getAscSQL: () => string;
  getDescSQL: () => string;
}
