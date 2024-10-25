import type { Knex } from 'knex';
import { BaseQueryAbstract } from './abstract';

export class BaseQuerySqlite extends BaseQueryAbstract {
  constructor(protected readonly knex: Knex) {
    super(knex);
  }

  jsonSelect(
    queryBuilder: Knex.QueryBuilder,
    dbFieldName: string,
    alias: string
  ): Knex.QueryBuilder {
    return queryBuilder.select(this.knex.raw(`MAX(??) AS ??`, [dbFieldName, alias]));
  }
}
