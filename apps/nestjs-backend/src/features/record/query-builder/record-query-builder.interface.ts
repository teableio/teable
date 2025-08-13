import type { IFilter } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldSelectName } from '../../field/field-select.type';
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
  tableNameMap?: Map<string, string>; // tableId -> dbTableName for nested lookup support
  additionalFields?: Map<string, IFieldInstance>; // Additional fields needed for rollup/lookup
}

/**
 * Interface for record query builder service
 * This interface defines the public API for building table record queries
 */
export interface IRecordQueryBuilder {
  /**
   * Create a record query builder with select fields for the given table
   * @param queryBuilder - existing query builder to use
   * @param tableIdOrDbTableName - The table ID or database table name
   * @param viewId - Optional view ID for filtering
   * @returns Promise<{ qb: Knex.QueryBuilder }> - The configured query builder
   */
  createRecordQueryBuilder(
    queryBuilder: Knex.QueryBuilder,
    tableIdOrDbTableName: string,
    viewId: string | undefined,
    filter?: IFilter,
    currentUserId?: string
  ): Promise<{ qb: Knex.QueryBuilder }>;
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
  /** Optional filter */
  filter?: IFilter;
  /** Optional Link field contexts for CTE generation */
  linkFieldContexts?: ILinkFieldContext[];
  currentUserId?: string;
}

/**
 * IRecordQueryFieldCteMap
 */
export type IRecordQueryFieldCteMap = Map<string, string>;

export type IRecordSelectionMap = Map<string, string>;

export interface IRecordQueryFilterContext {
  selectionMap: IRecordSelectionMap;
}
