import { Controller, Get, Param, Query } from '@nestjs/common';
import type { IViewAggregationVo, IViewRowCountVo } from '@teable-group/core';
import { IViewAggregationRo, viewAggregationRoSchema } from '@teable-group/core';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { AggregationOpenApiService } from './aggregation-open-api.service';

@Controller('api/table/:tableId/aggregation')
export class AggregationOpenApiController {
  constructor(private readonly aggregationOpenApiService: AggregationOpenApiService) {}

  @Get(':viewId')
  async getViewAggregations(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Query(new ZodValidationPipe(viewAggregationRoSchema)) query?: IViewAggregationRo
  ): Promise<IViewAggregationVo | null> {
    return await this.aggregationOpenApiService.getViewAggregations(tableId, viewId, query);
  }

  @Get(':viewId/rowCount')
  async getViewRowCount(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<IViewRowCountVo> {
    return await this.aggregationOpenApiService.getViewRowCount(tableId, viewId);
  }
}
