import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  IRawAggregationVo,
  IRawRowCountVo,
  IViewAggregationVo,
  IViewRowCountVo,
  StatisticsFunc,
  IViewAggregationRo,
  IViewRowCountRo,
} from '@teable-group/core';
import { getValidStatisticFunc } from '@teable-group/core';
import { forIn, isEmpty, map } from 'lodash';
import type { IWithView } from '../aggregation.service';
import { AggregationService } from '../aggregation.service';

@Injectable()
export class AggregationOpenApiService {
  constructor(private readonly aggregationService: AggregationService) {}

  async getViewAggregations(
    tableId: string,
    viewId: string,
    viewAggregationRo?: IViewAggregationRo
  ): Promise<IViewAggregationVo> {
    let withView: IWithView = { viewId, customFilter: viewAggregationRo?.filter };

    const fieldStatistics: Array<{ fieldId: string; statisticFunc: StatisticsFunc }> = [];

    const aggregationFields = viewAggregationRo?.field;
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

    const result = (await this.aggregationService.performAggregation(
      { tableId: tableId, withView },
      { fieldAggregation: true }
    )) as IRawAggregationVo;

    return { viewId: viewId, aggregations: result[viewId]?.aggregations };
  }

  async getViewRowCount(
    tableId: string,
    viewId: string,
    query?: IViewRowCountRo
  ): Promise<IViewRowCountVo> {
    const { filter } = query || {};
    const result = (await this.aggregationService.performAggregation(
      { tableId, withView: { viewId, customFilter: filter } },
      { rowCount: true }
    )) as IRawRowCountVo;

    return {
      rowCount: result[viewId]?.rowCount,
    };
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
}
