import { assertNever, DbFieldType, DriverClient } from '@teable/core';
import type { Knex } from 'knex';
import { getDriverName } from '../../utils/db-helpers';

// from knex define
export enum SchemaType {
  Binary = 'binary',
  Integer = 'integer',
  String = 'string',
  Text = 'text',
  Json = 'json',
  Jsonb = 'jsonb',
  Double = 'double',
  Datetime = 'datetime',
  Boolean = 'boolean',
}

export function dbType2knexFormat(knex: Knex, dbFieldType: DbFieldType) {
  const driverName = getDriverName(knex);

  switch (dbFieldType) {
    case DbFieldType.Blob:
      return SchemaType.Binary;
    case DbFieldType.Integer:
      return SchemaType.Integer;
    case DbFieldType.Json: {
      return driverName === DriverClient.Sqlite ? SchemaType.Text : SchemaType.Jsonb;
    }
    case DbFieldType.Real:
      return SchemaType.Double;
    case DbFieldType.Text:
      return SchemaType.Text;
    case DbFieldType.DateTime:
      return SchemaType.Datetime;
    case DbFieldType.Boolean:
      return SchemaType.Boolean;
    default:
      assertNever(dbFieldType);
  }
}
