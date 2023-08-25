import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  IViewAggregationRo,
  IViewAggregationVo,
  IViewRowCountVo,
  StatisticsFunc,
} from '@teable-group/core';
import { getValidStatisticFunc } from '@teable-group/core';
import { forIn, isEmpty, map, uniqBy } from 'lodash';
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
    let withView: IWithView = { viewId };

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

    return this.aggregationService.calculateViewField({ tableId: tableId, withView });
  }

  async getViewRowCount(tableId: string, viewId: string): Promise<IViewRowCountVo> {
    return this.aggregationService.calculateViewRowCount({ tableId, withView: { viewId } });
  }

  private async validFieldStats(
    tableId: string,
    fieldStatistics: Array<{ fieldId: string; statisticFunc: StatisticsFunc }>
  ) {
    const uniqueFieldStats = uniqBy(fieldStatistics, 'fieldId');
    if (isEmpty(uniqueFieldStats)) {
      return;
    }
    let result: Array<{ fieldId: string; statisticFunc: StatisticsFunc }> | undefined;

    const fieldIds = uniqueFieldStats.map((item) => item.fieldId);
    const { fieldInstanceMap } = await this.aggregationService.getFieldsData(tableId, fieldIds);

    uniqueFieldStats.forEach(({ fieldId, statisticFunc }) => {
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
