import type { Knex } from 'knex';

export abstract class BaseQueryAbstract {
  constructor(protected readonly knex: Knex) {}

  abstract jsonSelect(
    queryBuilder: Knex.QueryBuilder,
    dbFieldName: string,
    alias: string
  ): Knex.QueryBuilder;
}
