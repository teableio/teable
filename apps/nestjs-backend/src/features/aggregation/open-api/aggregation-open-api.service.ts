import { BadRequestException, Injectable } from '@nestjs/common';
import type { StatisticsFunc } from '@teable/core';
import { getValidStatisticFunc } from '@teable/core';
import type {
  IAggregationRo,
  IAggregationVo,
  ICalendarDailyCollectionRo,
  ICalendarDailyCollectionVo,
  IGroupPointsRo,
  IGroupPointsVo,
  IQueryBaseRo,
  IRowCountVo,
  ISearchIndexByQueryRo,
  ISearchCountRo,
} from '@teable/openapi';
import { forIn, isEmpty, map } from 'lodash';
import type { IWithView } from '../aggregation.service';
import { AggregationService } from '../aggregation.service';

@Injectable()
export class AggregationOpenApiService {
  constructor(private readonly aggregationService: AggregationService) {}

  async getAggregation(tableId: string, query?: IAggregationRo): Promise<IAggregationVo> {
    const { viewId, filter: customFilter, field: aggregationFields, groupBy } = query || {};

    let withView: IWithView = { viewId, customFilter, groupBy };

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
    });
    return { aggregations: result?.aggregations };
  }

  async getRowCount(tableId: string, query: IQueryBaseRo = {}): Promise<IRowCountVo> {
    const result = await this.aggregationService.performRowCount(tableId, query);
    return {
      rowCount: result.rowCount,
    };
  }

  async getGroupPoints(tableId: string, query?: IGroupPointsRo): Promise<IGroupPointsVo> {
    return await this.aggregationService.getGroupPoints(tableId, query);
  }

  async getCalendarDailyCollection(
    tableId: string,
    query: ICalendarDailyCollectionRo
  ): Promise<ICalendarDailyCollectionVo> {
    return await this.aggregationService.getCalendarDailyCollection(tableId, query);
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
}
