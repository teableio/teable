import type { IFilter, ISortItem } from '@teable/core';
import type { IAggregationField } from '@teable/openapi';
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
 * Options for creating record query builder
 */
export interface ICreateRecordQueryBuilderOptions {
  /** The table ID or database table name */
  tableIdOrDbTableName: string;
  /** Optional view ID for filtering */
  viewId?: string;
  /** Optional filter */
  filter?: IFilter;
  /** Optional sort */
  sort?: ISortItem[];
  /** Optional current user ID */
  currentUserId?: string;
}

/**
 * Options for creating record aggregate query builder
 */
export interface ICreateRecordAggregateBuilderOptions {
  /** The table ID or database table name */
  tableIdOrDbTableName: string;
  /** Optional view ID for filtering */
  viewId?: string;
  /** Optional filter */
  filter?: IFilter;
  /** Aggregation fields to compute */
  aggregationFields: IAggregationField[];
  /** Optional group by field IDs */
  groupBy?: string[];
  /** Optional current user ID */
  currentUserId?: string;
}

/**
 * Interface for record query builder service
 * This interface defines the public API for building table record queries
 */
export interface IRecordQueryBuilder {
  /**
   * Create a record query builder with select fields for the given table
   * @param queryBuilder - existing query builder to use
   * @param options - options for creating the query builder
   * @returns Promise<{ qb: Knex.QueryBuilder }> - The configured query builder
   */
  createRecordQueryBuilder(
    from: string,
    options: ICreateRecordQueryBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder; alias: string }>;

  /**
   * Create a record aggregate query builder for aggregation operations
   * @param queryBuilder - existing query builder to use
   * @param options - options for creating the aggregate query builder
   * @returns Promise<{ qb: Knex.QueryBuilder }> - The configured query builder with aggregation
   */
  createRecordAggregateBuilder(
    from: string,
    options: ICreateRecordAggregateBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder; alias: string }>;
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
  from: string;
  /** Optional filter */
  filter?: IFilter;
  /** Optional sort */
  sort?: ISortItem[];
  /** Optional Link field contexts for CTE generation */
  linkFieldContexts?: ILinkFieldContext[];
  currentUserId?: string;
}

/**
 * IRecordQueryFieldCteMap
 */
export type IRecordQueryFieldCteMap = Map<string, string>;

export type IRecordSelectionMap = Map<string, IFieldSelectName>;

export interface IRecordQueryFilterContext {
  selectionMap: IRecordSelectionMap;
}

export interface IRecordQuerySortContext {
  selectionMap: IRecordSelectionMap;
}

export interface IRecordQueryGroupContext {
  selectionMap: IRecordSelectionMap;
}
