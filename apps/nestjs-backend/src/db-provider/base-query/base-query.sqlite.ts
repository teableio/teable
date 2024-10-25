import type { Knex } from 'knex';
import { BaseQueryAbstract } from './abstract';

export class BaseQuerySqlite extends BaseQueryAbstract {
  constructor(protected readonly knex: Knex) {
    super(knex);
  }
}
