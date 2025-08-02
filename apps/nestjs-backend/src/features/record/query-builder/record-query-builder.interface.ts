import type { Knex } from 'knex';
import type { IFieldInstance } from '../../field/model/factory';

/**
 * Interface for record query builder service
 * This interface defines the public API for building table record queries
 */
export interface IRecordQueryBuilder {
  /**
   * Build a query builder with select fields for the given table and fields
   * @param queryBuilder - existing query builder to use
   * @param tableId - The table ID
   * @param viewId - Optional view ID for filtering
   * @param fields - Array of field instances to select
   * @returns Promise<Knex.QueryBuilder> - The configured query builder
   */
  buildQuery(
    queryBuilder: Knex.QueryBuilder,
    tableId: string,
    viewId: string | undefined,
    fields: IFieldInstance[]
  ): Knex.QueryBuilder;
}

/**
 * Parameters for building record queries
 */
export interface IRecordQueryParams {
  /** The table ID */
  tableId: string;
  /** Optional view ID */
  viewId?: string;
  /** Array of field instances */
  fields: IFieldInstance[];
  /** Optional database table name (if already known) */
  dbTableName?: string;
  /** Optional existing query builder */
  queryBuilder: Knex.QueryBuilder;
}
