/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Knex } from 'knex';
import knex from 'knex';
import { DriverClient } from '../../utils/constants';

knex.QueryBuilder.extend('columnList', function (tableName: string) {
  const driverClient = this.client.config?.client as DriverClient;
  switch (driverClient) {
    case DriverClient.SQLITE:
      return knex(this.client.config).raw(`PRAGMA table_info(??)`, tableName);
    case DriverClient.PG:
      this.select({
        name: 'column_name',
        type: 'data_type',
        dflt_value: 'column_default',
        notnull: 'is_nullable',
      })
        .from('information_schema.columns')
        .where('table_name', tableName);
      break;
  }
  return this;
});

declare module 'knex' {
  namespace Knex {
    interface QueryBuilder {
      columnList(tableName: string): Knex.QueryBuilder;
    }
  }
}

export { knex };
