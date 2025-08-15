import { Injectable, NotImplementedException } from '@nestjs/common';
import type { IFilter, IGroup } from '@teable/core';
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
import type { IAggregationService, IWithView } from './aggregation.service.interface';

/**
 * Version 2 implementation of the aggregation service
 * This is a placeholder implementation that will be developed in the future
 * All methods currently throw NotImplementedException
 */
@Injectable()
export class AggregationServiceV2 implements IAggregationService {
  /**
   * Perform aggregation operations on table data
   * @param params - Parameters for aggregation including tableId, field IDs, view settings, and search
   * @returns Promise<IRawAggregationValue> - The aggregation results
   * @throws NotImplementedException - This method is not yet implemented
   */
  async performAggregation(params: {
    tableId: string;
    withFieldIds?: string[];
    withView?: IWithView;
    search?: [string, string?, boolean?];
  }): Promise<IRawAggregationValue> {
    throw new NotImplementedException(
      `AggregationServiceV2.performAggregation is not implemented yet. Params: ${JSON.stringify(params)}`
    );
  }

  /**
   * Perform grouped aggregation operations
   * @param params - Parameters for grouped aggregation
   * @returns Promise<IRawAggregations> - The grouped aggregation results
   * @throws NotImplementedException - This method is not yet implemented
   */
  async performGroupedAggregation(params: {
    aggregations: IRawAggregations;
    statisticFields: IAggregationField[] | undefined;
    tableId: string;
    filter?: IFilter;
    search?: [string, string?, boolean?];
    groupBy?: IGroup;
    dbTableName: string;
    fieldInstanceMap: Record<string, IFieldInstance>;
    withView?: IWithView;
  }): Promise<IRawAggregations> {
    throw new NotImplementedException(
      `AggregationServiceV2.performGroupedAggregation is not implemented yet. TableId: ${params.tableId}`
    );
  }

  /**
   * Get row count for a table with optional filtering
   * @param tableId - The table ID
   * @param queryRo - Query parameters for filtering
   * @returns Promise<IRawRowCountValue> - The row count result
   * @throws NotImplementedException - This method is not yet implemented
   */
  async performRowCount(tableId: string, queryRo: IQueryBaseRo): Promise<IRawRowCountValue> {
    throw new NotImplementedException(
      `AggregationServiceV2.performRowCount is not implemented yet. TableId: ${tableId}, Query: ${JSON.stringify(queryRo)}`
    );
  }

  /**
   * Get field data for a table
   * @param tableId - The table ID
   * @param fieldIds - Optional array of field IDs to filter
   * @param withName - Whether to include field names in the mapping
   * @returns Promise with field instances and field instance map
   * @throws NotImplementedException - This method is not yet implemented
   */
  async getFieldsData(
    tableId: string,
    fieldIds?: string[],
    withName?: boolean
  ): Promise<{
    fieldInstances: IFieldInstance[];
    fieldInstanceMap: Record<string, IFieldInstance>;
  }> {
    throw new NotImplementedException(
      `AggregationServiceV2.getFieldsData is not implemented yet. TableId: ${tableId}, FieldIds: ${fieldIds?.join(',')}, WithName: ${withName}`
    );
  }

  /**
   * Get group points for a table
   * @param tableId - The table ID
   * @param query - Optional query parameters
   * @returns Promise with group points data
   * @throws NotImplementedException - This method is not yet implemented
   */
  async getGroupPoints(tableId: string, query?: IGroupPointsRo): Promise<IGroupPoint[]> {
    throw new NotImplementedException(
      `AggregationServiceV2.getGroupPoints is not implemented yet. TableId: ${tableId}, Query: ${JSON.stringify(query)}`
    );
  }

  /**
   * Get search count for a table
   * @param tableId - The table ID
   * @param queryRo - Search query parameters
   * @param projection - Optional field projection
   * @returns Promise with search count result
   * @throws NotImplementedException - This method is not yet implemented
   */
  async getSearchCount(
    tableId: string,
    queryRo: ISearchCountRo,
    projection?: string[]
  ): Promise<{ count: number }> {
    throw new NotImplementedException(
      `AggregationServiceV2.getSearchCount is not implemented yet. TableId: ${tableId}, Query: ${JSON.stringify(queryRo)}, Projection: ${projection?.join(',')}`
    );
  }

  /**
   * Get record index by search order
   * @param tableId - The table ID
   * @param queryRo - Search index query parameters
   * @param projection - Optional field projection
   * @returns Promise with search index results
   * @throws NotImplementedException - This method is not yet implemented
   */
  async getRecordIndexBySearchOrder(
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
  > {
    throw new NotImplementedException(
      `AggregationServiceV2.getRecordIndexBySearchOrder is not implemented yet. TableId: ${tableId}, Query: ${JSON.stringify(queryRo)}, Projection: ${projection?.join(',')}`
    );
  }

  /**
   * Get calendar daily collection data
   * @param tableId - The table ID
   * @param query - Calendar collection query parameters
   * @returns Promise<ICalendarDailyCollectionVo> - The calendar collection data
   * @throws NotImplementedException - This method is not yet implemented
   */
  async getCalendarDailyCollection(
    tableId: string,
    query: ICalendarDailyCollectionRo
  ): Promise<ICalendarDailyCollectionVo> {
    throw new NotImplementedException(
      `AggregationServiceV2.getCalendarDailyCollection is not implemented yet. TableId: ${tableId}, Query: ${JSON.stringify(query)}`
    );
  }
}
