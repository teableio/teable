import { assertNever, DbFieldType, DriverClient } from '@teable-group/core';
import type { Knex } from 'knex';
import { getDriverName } from '../../utils/db-helpers';

export function dbType2knexFormat(knex: Knex, dbFieldType: DbFieldType) {
  const driverName = getDriverName(knex);

  switch (dbFieldType) {
    case DbFieldType.Blob:
      return 'binary';
    case DbFieldType.Integer:
      return 'integer';
    case DbFieldType.Json: {
      return driverName === DriverClient.Sqlite ? 'text' : 'json';
    }
    case DbFieldType.Real:
      return 'double';
    case DbFieldType.Text:
      return 'text';
    case DbFieldType.DateTime:
      return 'datetime';
    case DbFieldType.Boolean:
      return 'boolean';
    default:
      assertNever(dbFieldType);
  }
}
