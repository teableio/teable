import type { IFilter, IGroup, ISortItem, TableDomain } from '@teable/core';
import type { IAggregationField } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IFieldSelectName } from './field-select.type';

export interface IPrepareViewParams {
  tableIdOrDbTableName: string;
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
  /** Optional group by */
  groupBy?: IGroup;
  /** Optional current user ID */
  currentUserId?: string;
}

/**
 * Interface for record query builder service
 * This interface defines the public API for building table record queries
 */
export interface IRecordQueryBuilder {
  prepareView(
    from: string,
    params: IPrepareViewParams
  ): Promise<{ qb: Knex.QueryBuilder; table: TableDomain }>;
  /**
   * Create a record query builder with select fields for the given table
   * @param queryBuilder - existing query builder to use
   * @param options - options for creating the query builder
   * @returns Promise<{ qb: Knex.QueryBuilder }> - The configured query builder
   */
  createRecordQueryBuilder(
    from: string,
    options: ICreateRecordQueryBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder; alias: string; selectionMap: IReadonlyRecordSelectionMap }>;

  /**
   * Create a record aggregate query builder for aggregation operations
   * @param queryBuilder - existing query builder to use
   * @param options - options for creating the aggregate query builder
   * @returns Promise<{ qb: Knex.QueryBuilder }> - The configured query builder with aggregation
   */
  createRecordAggregateBuilder(
    from: string,
    options: ICreateRecordAggregateBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder; alias: string; selectionMap: IReadonlyRecordSelectionMap }>;
}

/**
 * IRecordQueryFieldCteMap
 */
export type IRecordQueryFieldCteMap = Map<string, string>;

export type IRecordSelectionMap = Map<string, IFieldSelectName>;
export type IReadonlyRecordSelectionMap = ReadonlyMap<string, IFieldSelectName>;

export interface IRecordQueryFilterContext {
  selectionMap: IReadonlyRecordSelectionMap;
}

export interface IRecordQuerySortContext {
  selectionMap: IReadonlyRecordSelectionMap;
}

export interface IRecordQueryGroupContext {
  selectionMap: IReadonlyRecordSelectionMap;
}

export interface IRecordQueryAggregateContext {
  selectionMap: IReadonlyRecordSelectionMap;
  tableDbName: string;
  tableAlias: string;
}

/**
 * Readonly state interface for query-builder shared state
 * Provides read access to CTE map and selection map.
 */
export interface IReadonlyQueryBuilderState {
  /** Get immutable view of fieldId -> CTE name */
  getFieldCteMap(): ReadonlyMap<string, string>;
  /** Get immutable view of fieldId -> selection (column/expression) */
  getSelectionMap(): ReadonlyMap<string, IFieldSelectName>;
  /** Convenience helpers */
  hasFieldCte(fieldId: string): boolean;
  getCteName(fieldId: string): string | undefined;
}

/**
 * Mutable state interface for query-builder shared state
 * Extends readonly with mutation capabilities. Only mutating visitors/services should hold this.
 */
export interface IMutableQueryBuilderState extends IReadonlyQueryBuilderState {
  /** Set fieldId -> CTE name mapping */
  setFieldCte(fieldId: string, cteName: string): void;
  /** Clear all CTE mappings (rarely needed) */
  clearFieldCtes(): void;

  /** Record field selection for top-level select */
  setSelection(fieldId: string, selection: IFieldSelectName): void;
  /** Remove a selection entry */
  deleteSelection(fieldId: string): void;
  /** Clear selections */
  clearSelections(): void;
}
