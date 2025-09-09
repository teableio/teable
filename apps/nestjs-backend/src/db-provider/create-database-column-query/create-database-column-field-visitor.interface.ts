import type { TableDomain } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { IDbProvider } from '../db.provider.interface';

/**
 * Context interface for database column creation
 */
export interface ICreateDatabaseColumnContext {
  /** Knex table builder instance */
  table: Knex.CreateTableBuilder;
  tableDomain: TableDomain;
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
  /** Whether this is a new table creation (affects SQLite generated columns) */
  isNewTable?: boolean;
  /** Current table ID (for link field foreign key creation) */
  tableId: string;
  /** Current table name (for link field foreign key creation) */
  tableName: string;
  /** Knex instance (for link field foreign key creation) */
  knex: Knex;
  /** Table name mapping for foreign key creation (tableId -> dbTableName) */
  tableNameMap: Map<string, string>;
  /** Whether this is a symmetric field (should not create foreign key structures) */
  isSymmetricField?: boolean;
  /** When true, do not create the base column for Link fields (FK/junction only). */
  skipBaseColumnCreation?: boolean;
}
