import type { Knex } from 'knex';
import type { IFieldInstance } from '../../field/model/factory';

/**
 * Context information for Link fields needed for CTE generation
 */
export interface ILinkFieldContext {
  linkField: IFieldInstance; // Can be Link field or any Lookup field
  lookupField: IFieldInstance;
  foreignTableName: string;
}

/**
 * Complete context for CTE generation including main table name
 */
export interface ILinkFieldCteContext {
  linkFieldContexts: ILinkFieldContext[];
  mainTableName: string;
}

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
   * @param linkFieldContexts - Optional Link field contexts for CTE generation
   * @returns Knex.QueryBuilder - The configured query builder
   */
  buildQuery(
    queryBuilder: Knex.QueryBuilder,
    tableId: string,
    viewId: string | undefined,
    fields: IFieldInstance[],
    linkFieldCteContext: ILinkFieldCteContext
  ): Knex.QueryBuilder;

  /**
   * Create Link field contexts for CTE generation
   * @param fields - Array of field instances
   * @param tableId - Table ID for reference
   * @param mainTableName - Main table database name
   * @returns Promise<ILinkFieldCteContext> - Complete CTE context with main table name
   */
  createLinkFieldContexts(
    fields: IFieldInstance[],
    tableId: string,
    mainTableName: string
  ): Promise<ILinkFieldCteContext>;
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
  /** Optional Link field contexts for CTE generation */
  linkFieldContexts?: ILinkFieldContext[];
}
