import type { Knex } from 'knex';

export interface IGroupQueryInterface {
  appendGroupBuilder(): Knex.QueryBuilder;
}

export interface IGroupQueryExtra {
  isDistinct?: boolean;
}
