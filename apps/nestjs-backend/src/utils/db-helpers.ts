import { DriverClient } from '@teable/core';
import type { Knex } from 'knex';
import { get } from 'lodash';

export function getDriverName(knex: Knex | Knex.QueryBuilder) {
  return get(knex, 'client.config.client', '') as DriverClient;
}

export function isPostgreSQL(knex: Knex) {
  return getDriverName(knex) === DriverClient.Pg;
}

export function isSQLite(knex: Knex) {
  return getDriverName(knex) === DriverClient.Sqlite;
}
