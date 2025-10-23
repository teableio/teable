import type { FieldCore, IFilter, IGroup, ISortItem, TableDomain } from '@teable/core';
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
  useQueryModel?: boolean;
  /** Limit SELECT to these field IDs (plus system columns) */
  projection?: string[];
  /** Optional pagination limit (take) */
  limit?: number;
  /** Optional pagination offset (skip) */
  offset?: number;
  /** When true, hide-not-match search filtering is applied */
  hasSearch?: boolean;
  /** Optional fallback field used for default ordering */
  defaultOrderField?: string;
  /**
   * When true, select raw DB values for fields instead of formatted display values.
   * Useful for UPDATE ... FROM (SELECT ...) operations to avoid type mismatches (e.g., timestamptz vs text).
   */
  rawProjection?: boolean;
  /**
   * When true, prefer raw field references when converting formulas to SQL (skip formatting).
   * Typically used alongside rawProjection when the consumer needs source values (e.g., jsonb) rather than formatted text.
   */
  preferRawFieldReferences?: boolean;
  /**
   * Optional list of record IDs to restrict the query to before generating CTEs.
   * Useful when the caller intends to apply a final WHERE IN "__id" (...) filter anyway.
   */
  restrictRecordIds?: string[];
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
  /** Optional projection to minimize CTE/select */
  projection?: string[];
  useQueryModel?: boolean;
  /**
   * Optional list of record IDs to restrict the query to before generating CTEs.
   */
  restrictRecordIds?: string[];
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

// Query context: whether we build directly from base table or from materialized view
export type IRecordQueryContext = 'table' | 'tableCache' | 'view';

export interface IRecordQueryFilterContext {
  selectionMap: IReadonlyRecordSelectionMap;
  fieldReferenceSelectionMap?: Map<string, string>;
  fieldReferenceFieldMap?: Map<string, FieldCore>;
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
  /** Get current query context (table or view) */
  getContext(): IRecordQueryContext;
  /** Get main table alias used in the top-level FROM */
  getMainTableAlias(): string | undefined;
  /** Get the current source relation used for the main table (table/view/base CTE) */
  getMainTableSource(): string | undefined;
  /** Get the original physical source relation for the main table */
  getOriginalMainTableSource(): string | undefined;
  /** Get the optional pagination base CTE name */
  getBaseCteName(): string | undefined;
  /** Convenience helpers */
  hasFieldCte(fieldId: string): boolean;
  getCteName(fieldId: string): string | undefined;
  /** Check if a CTE has already been joined to the main query */
  isCteJoined(cteName: string): boolean;
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
  /** Set main table alias */
  setMainTableAlias(alias: string): void;
  /** Set main table source relation (table/view/cte) */
  setMainTableSource(source: string): void;
  /** Set pagination base CTE name */
  setBaseCteName(cteName: string | undefined): void;
  /** Mark that a CTE has been joined to the main query */
  markCteJoined(cteName: string): void;
}
