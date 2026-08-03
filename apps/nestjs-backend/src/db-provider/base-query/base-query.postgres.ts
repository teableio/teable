import type { Knex } from 'knex';
import { BaseQueryAbstract } from './abstract';

export class BaseQueryPostgres extends BaseQueryAbstract {
  constructor(protected readonly knex: Knex) {
    super(knex);
  }

  jsonSelect(
    queryBuilder: Knex.QueryBuilder,
    dbFieldName: string,
    alias: string
  ): Knex.QueryBuilder {
    // dbFieldName is a pre-quoted qualified identifier path
    return queryBuilder.select(this.knex.raw(`MAX(${dbFieldName}::text) AS ??`, [alias]));
  }
}
