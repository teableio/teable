import type { IFilter, IGroup, StatisticsFunc } from '@teable/core';
import type {
  IAggregationField,
  IQueryBaseRo,
  IRawAggregationValue,
  IRawAggregations,
  IRawRowCountValue,
  IGroupPointsRo,
  IGroupPoint,
  ICalendarDailyCollectionRo,
  ICalendarDailyCollectionVo,
  ISearchIndexByQueryRo,
  ISearchCountRo,
} from '@teable/openapi';
import type { IFieldInstance } from '../field/model/factory';

/**
 * Interface for aggregation service operations
 * This interface defines the public API for aggregation-related functionality
 */
export interface IAggregationService {
  /**
   * Perform aggregation operations on table data
   * @param params - Parameters for aggregation including tableId, field IDs, view settings, and search
   * @returns Promise<IRawAggregationValue> - The aggregation results
   */
  performAggregation(params: {
    tableId: string;
    withFieldIds?: string[];
    withView?: IWithView;
    search?: [string, string?, boolean?];
    useQueryModel?: boolean;
  }): Promise<IRawAggregationValue>;

  /**
   * Perform grouped aggregation operations
   * @param params - Parameters for grouped aggregation
   * @returns Promise<IRawAggregations> - The grouped aggregation results
   */
  performGroupedAggregation(params: {
    aggregations: IRawAggregations;
    statisticFields: IAggregationField[] | undefined;
    tableId: string;
    filter?: IFilter;
    search?: [string, string?, boolean?];
    groupBy?: IGroup;
    dbTableName: string;
    fieldInstanceMap: Record<string, IFieldInstance>;
    withView?: IWithView;
  }): Promise<IRawAggregations>;

  /**
   * Get row count for a table with optional filtering
   * @param tableId - The table ID
   * @param queryRo - Query parameters for filtering
   * @returns Promise<IRawRowCountValue> - The row count result
   */
  performRowCount(tableId: string, queryRo: IQueryBaseRo): Promise<IRawRowCountValue>;

  /**
   * Get field data for a table
   * @param tableId - The table ID
   * @param fieldIds - Optional array of field IDs to filter
   * @param withName - Whether to include field names in the mapping
   * @returns Promise with field instances and field instance map
   */
  getFieldsData(
    tableId: string,
    fieldIds?: string[],
    withName?: boolean
  ): Promise<{
    fieldInstances: IFieldInstance[];
    fieldInstanceMap: Record<string, IFieldInstance>;
  }>;

  /**
   * Get group points for a table
   * @param tableId - The table ID
   * @param query - Optional query parameters
   * @returns Promise with group points data
   */
  getGroupPoints(
    tableId: string,
    query?: IGroupPointsRo,
    useQueryModel?: boolean
  ): Promise<IGroupPoint[]>;

  /**
   * Get search count for a table
   * @param tableId - The table ID
   * @param queryRo - Search query parameters
   * @param projection - Optional field projection
   * @returns Promise with search count result
   */
  getSearchCount(
    tableId: string,
    queryRo: ISearchCountRo,
    projection?: string[]
  ): Promise<{ count: number }>;

  /**
   * Get record index by search order
   * @param tableId - The table ID
   * @param queryRo - Search index query parameters
   * @param projection - Optional field projection
   * @returns Promise with search index results
   */
  getRecordIndexBySearchOrder(
    tableId: string,
    queryRo: ISearchIndexByQueryRo,
    projection?: string[]
  ): Promise<
    | {
        index: number;
        fieldId: string;
        recordId: string;
      }[]
    | null
  >;

  /**
   * Get calendar daily collection data
   * @param tableId - The table ID
   * @param query - Calendar collection query parameters
   * @returns Promise<ICalendarDailyCollectionVo> - The calendar collection data
   */
  getCalendarDailyCollection(
    tableId: string,
    query: ICalendarDailyCollectionRo
  ): Promise<ICalendarDailyCollectionVo>;
}

/**
 * Interface for view-related parameters used in aggregation operations
 */
export interface IWithView {
  viewId?: string;
  groupBy?: IGroup;
  customFilter?: IFilter;
  customFieldStats?: ICustomFieldStats[];
}

/**
 * Interface for custom field statistics configuration
 */
export interface ICustomFieldStats {
  fieldId: string;
  statisticFunc?: StatisticsFunc;
}
