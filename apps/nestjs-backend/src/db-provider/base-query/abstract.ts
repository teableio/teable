import type { Knex } from 'knex';

export abstract class BaseQueryAbstract {
  constructor(protected readonly knex: Knex) {}

  jsonSelect(
    queryBuilder: Knex.QueryBuilder,
    dbFieldName: string,
    alias: string
  ): Knex.QueryBuilder {
    return queryBuilder.select(this.knex.raw(`MAX(??::text) AS ??`, [dbFieldName, alias]));
  }
}
