import type { Knex } from 'knex';

/**
 * Context interface for database column dropping
 */
export interface IDropDatabaseColumnContext {
  /** Table name */
  tableName: string;
  /** Knex instance for building queries */
  knex: Knex;
  linkContext?: { tableId: string; tableNameMap: Map<string, string> };
}
