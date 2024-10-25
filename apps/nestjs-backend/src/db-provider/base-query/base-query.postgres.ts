import type { Knex } from 'knex';
import { BaseQueryAbstract } from './abstract';

export class BaseQueryPostgres extends BaseQueryAbstract {
  constructor(protected readonly knex: Knex) {
    super(knex);
  }
}
