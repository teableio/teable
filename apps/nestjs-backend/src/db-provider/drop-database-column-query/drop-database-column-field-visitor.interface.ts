/* eslint-disable @typescript-eslint/naming-convention */
import type { Knex } from 'knex';

/**
 * Operation types for database column dropping
 */
export enum DropColumnOperationType {
  /** Complete field deletion - remove field and all related foreign keys/tables */
  DELETE_FIELD = 'DELETE_FIELD',
  /** Field type conversion - only remove field columns, preserve foreign key relationships */
  CONVERT_FIELD = 'CONVERT_FIELD',
  /** Delete symmetric field in bidirectional to unidirectional conversion - preserve foreign keys for main field */
  DELETE_SYMMETRIC_FIELD = 'DELETE_SYMMETRIC_FIELD',
}

/**
 * Context interface for database column dropping
 */
export interface IDropDatabaseColumnContext {
  /** Table name */
  tableName: string;
  /** Knex instance for building queries */
  knex: Knex;
  /** Link context for link field operations */
  linkContext?: { tableId: string; tableNameMap: Map<string, string> };
  /** Operation type to determine deletion strategy */
  operationType?: DropColumnOperationType;
}
