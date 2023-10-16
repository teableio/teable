import { DriverClient } from '@teable-group/core';
import type { Knex } from 'knex';
import { get } from 'lodash';

export function getDriverName(knex: Knex) {
  return get(knex, 'client.driverName', '');
}

export function isPostgreSQL(knex: Knex) {
  return getDriverName(knex) === DriverClient.PG;
}

export function isSQLite(knex: Knex) {
  return getDriverName(knex) === DriverClient.SQLITE;
}
