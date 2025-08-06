import type { IFieldMap } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IFieldInstance } from './model/factory';

/**
 * Context interface for database column creation
 */
export interface ICreateDatabaseColumnContext {
  /** Knex table builder instance */
  table: Knex.CreateTableBuilder;
  /** Field ID */
  fieldId: string;
  /** the Field instance to add */
  field: IFieldInstance;
  /** Database field name */
  dbFieldName: string;
  /** Whether the field is unique */
  unique?: boolean;
  /** Whether the field is not null */
  notNull?: boolean;
  /** Database provider for formula conversion */
  dbProvider?: IDbProvider;
  /** Field map for formula conversion context */
  fieldMap?: IFieldMap;
  /** Whether this is a new table creation (affects SQLite generated columns) */
  isNewTable?: boolean;
}
