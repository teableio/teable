/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/naming-convention */
import { DriverClient } from '@teable-group/core';
import knex from 'knex';
import { getDriverName } from '../../utils/db-helpers';

knex.QueryBuilder.extend('columnList', function (tableName: string) {
  const driverClient = getDriverName(this);

  switch (driverClient) {
    case DriverClient.Sqlite:
      return knex(this.client.config).raw(`PRAGMA table_info(??)`, tableName);
    case DriverClient.Pg: {
      const [schema, name] = tableName.split('.');
      this.select({
        name: 'column_name',
        type: 'data_type',
        dflt_value: 'column_default',
        notnull: 'is_nullable',
      })
        .from('information_schema.columns')
        .where('table_name', name)
        .where('table_schema', schema);
      break;
    }
  }
  return this;
});

knex.QueryBuilder.extend('dropIndex', function (tableName: string, indexName: string) {
  const driverClient = getDriverName(this);

  switch (driverClient) {
    case DriverClient.Sqlite:
      return knex(this.client.config).raw(`DROP INDEX ??`, [indexName]);
    case DriverClient.Pg: {
      const [schema] = tableName.split('.');
      return knex(this.client.config).raw(`DROP INDEX ??.??`, [schema, indexName]);
      break;
    }
  }
  return this;
});

declare module 'knex' {
  namespace Knex {
    interface QueryBuilder {
      columnList(tableName: string): Knex.QueryBuilder;
    }
    interface QueryBuilder {
      dropIndex(tableName: string, indexName: string): Knex.QueryBuilder;
    }
  }
}

export { knex };
