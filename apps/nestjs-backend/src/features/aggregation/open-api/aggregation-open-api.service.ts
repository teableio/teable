import { BadRequestException, Injectable } from '@nestjs/common';
import type { StatisticsFunc } from '@teable/core';
import { getValidStatisticFunc } from '@teable/core';
import type {
  ISearchIndexByQueryRo,
  IAggregationRo,
  IAggregationVo,
  ICalendarDailyCollectionRo,
  ICalendarDailyCollectionVo,
  IGroupPointsRo,
  IGroupPointsVo,
  IRowCountRo,
  IRowCountVo,
  ISearchCountRo,
  IRecordIndexRo,
  IRecordIndexVo,
  ISelectionAggregationRo,
} from '@teable/openapi';
import { forIn, isEmpty, map } from 'lodash';
import { RecordService } from '../../record/record.service';
import { IAggregationService } from '../aggregation.service.interface';
import type { IWithView } from '../aggregation.service.interface';
import { InjectAggregationService } from '../aggregation.service.provider';

@Injectable()
export class AggregationOpenApiService {
  constructor(
    @InjectAggregationService() private readonly aggregationService: IAggregationService,
    private readonly recordService: RecordService
  ) {}

  async getAggregation(tableId: string, query?: IAggregationRo): Promise<IAggregationVo> {
    const {
      viewId,
      filter: customFilter,
      field: aggregationFields,
      groupBy,
      ignoreViewQuery,
    } = query || {};

    let withView: IWithView = {
      viewId: ignoreViewQuery ? undefined : viewId,
      customFilter,
      groupBy,
    };

    const fieldStatistics: Array<{ fieldId: string; statisticFunc: StatisticsFunc }> = [];

    forIn(aggregationFields, (value: string[], key) => {
      const fieldStats = map(value, (item) => ({
        fieldId: item,
        statisticFunc: key as StatisticsFunc,
      }));

      fieldStatistics.push(...fieldStats);
    });

    const validFieldStats = await this.validFieldStats(tableId, fieldStatistics);
    if (validFieldStats) {
      withView = { ...withView, customFieldStats: validFieldStats };
    }

    const result = await this.aggregationService.performAggregation({
      tableId: tableId,
      withView,
      search: query?.search,
      useQueryModel: true,
    });
    return { aggregations: result?.aggregations };
  }

  async getRowCount(tableId: string, query: IRowCountRo = {}): Promise<IRowCountVo> {
    const result = await this.aggregationService.performRowCount(tableId, query);
    return {
      rowCount: result.rowCount,
    };
  }

  async getGroupPoints(
    tableId: string,
    query?: IGroupPointsRo,
    useQueryModel = true
  ): Promise<IGroupPointsVo> {
    return await this.aggregationService.getGroupPoints(tableId, query, useQueryModel);
  }

  async getCalendarDailyCollection(
    tableId: string,
    query: ICalendarDailyCollectionRo
  ): Promise<ICalendarDailyCollectionVo> {
    return await this.aggregationService.getCalendarDailyCollection(tableId, query);
  }

  async getRecordIndex(tableId: string, query: IRecordIndexRo): Promise<IRecordIndexVo> {
    return await this.aggregationService.getRecordIndex(tableId, query);
  }

  private async validFieldStats(
    tableId: string,
    fieldStatistics: Array<{ fieldId: string; statisticFunc: StatisticsFunc }>
  ) {
    if (isEmpty(fieldStatistics)) {
      return;
    }
    let result: Array<{ fieldId: string; statisticFunc: StatisticsFunc }> | undefined;

    const fieldIds = fieldStatistics.map((item) => item.fieldId);
    const { fieldInstanceMap } = await this.aggregationService.getFieldsData(tableId, fieldIds);

    fieldStatistics.forEach(({ fieldId, statisticFunc }) => {
      const fieldInstance = fieldInstanceMap[fieldId];
      if (!fieldInstance) {
        throw new BadRequestException(`field: '${fieldId}' is invalid`);
      }

      const validStatisticFunc = getValidStatisticFunc(fieldInstance);
      if (!validStatisticFunc.includes(statisticFunc)) {
        throw new BadRequestException(
          `field: '${fieldId}', aggregation func: '${statisticFunc}' is invalid, Only the following func are allowed: [${validStatisticFunc}]`
        );
      }

      (result = result ?? []).push({ fieldId, statisticFunc });
    });
    return result;
  }

  public async getSearchCount(tableId: string, queryRo: ISearchCountRo, projection?: string[]) {
    return await this.aggregationService.getSearchCount(tableId, queryRo, projection);
  }

  public async getRecordIndexBySearchOrder(
    tableId: string,
    queryRo: ISearchIndexByQueryRo,
    projection?: string[]
  ) {
    return await this.aggregationService.getRecordIndexBySearchOrder(tableId, queryRo, projection);
  }

  // Selection aggregation = the existing aggregation flow + a row-range slice.
  // Same recipe as getAggregation: build customFieldStats, validate them, then
  // delegate to performAggregation. Two deltas:
  //   1. skip/take/orderBy thread through to scope the BASE CTE to the slice.
  //   2. groupBy (if any) is folded INTO orderBy as a sort prefix and NOT
  //      passed via withView. Two reasons:
  //        a. `performGroupedAggregation` keys aggregations by fieldId, so a
  //           request asking multiple funcs for the same field (chip asks
  //           Sum + Filled) loses all but the last entry. Bypassing it keeps
  //           every (fieldId, aggFunc) result intact.
  //        b. The same routine re-runs handleAggregation without skip/take,
  //           which would compute group totals over the whole view instead of
  //           the slice — pointless work for the chip, which only reads
  //           `total`.
  //      The group prefix in orderBy preserves grid row order (records list
  //      uses [...groupBy, ...orderBy] for its sort, mirrored here).
  async getSelectionAggregation(
    tableId: string,
    query: ISelectionAggregationRo
  ): Promise<IAggregationVo> {
    const {
      viewId,
      filter: customFilter,
      field: aggregationFields,
      groupBy,
      collapsedGroupIds,
      ignoreViewQuery,
      skip,
      take,
      orderBy,
    } = query;

    const sortWithGroup = [...(groupBy ?? []), ...(orderBy ?? [])];

    // Translate collapsedGroupIds into a SQL filter (records in collapsed
    // groups are excluded from the BASE CTE) so skip/take indexes the same
    // visible-record sequence the grid renders. Same recipe records list uses.
    let filterWithCollapsed = customFilter;
    if (groupBy?.length && collapsedGroupIds?.length) {
      const { filter } = await this.recordService.getGroupRelatedData(tableId, {
        viewId,
        ignoreViewQuery,
        filter: customFilter,
        groupBy,
        collapsedGroupIds,
        search: query.search,
      });
      filterWithCollapsed = filter;
    }

    let withView: IWithView = {
      viewId: ignoreViewQuery ? undefined : viewId,
      customFilter: filterWithCollapsed,
      // Intentionally NOT passing groupBy (folded into orderBy above).
    };

    const fieldStatistics: Array<{ fieldId: string; statisticFunc: StatisticsFunc }> = [];
    forIn(aggregationFields, (value: string[], key) => {
      const fieldStats = map(value, (item) => ({
        fieldId: item,
        statisticFunc: key as StatisticsFunc,
      }));
      fieldStatistics.push(...fieldStats);
    });

    const validFieldStats = await this.validFieldStats(tableId, fieldStatistics);
    if (validFieldStats) {
      withView = { ...withView, customFieldStats: validFieldStats };
    }

    const result = await this.aggregationService.performAggregation({
      tableId,
      withView,
      search: query.search,
      // useQueryModel must stay false here: the tableCache path skips BASE CTE
      // pagination, which would silently aggregate the entire view.
      useQueryModel: false,
      skip,
      take,
      orderBy: sortWithGroup.length ? sortWithGroup : undefined,
    });
    return { aggregations: result?.aggregations };
  }
}
