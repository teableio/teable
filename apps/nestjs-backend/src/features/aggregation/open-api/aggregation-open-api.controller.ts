import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IViewAggregationVo, IViewRowCountVo } from '@teable-group/core';
import { viewAggregationRo, IViewAggregationRo } from '@teable-group/core';
import { ZodValidationPipe } from 'src/zod.validation.pipe';
import { ApiResponse, responseWrap } from '../../../utils';
import { AggregationOpenApiService } from './aggregation-open-api.service';

@ApiBearerAuth()
@ApiTags('aggregation')
@Controller('api/table/:tableId/aggregation')
export class AggregationOpenApiController {
  constructor(private readonly aggregationOpenApiService: AggregationOpenApiService) {}

  @Get(':viewId')
  @ApiOperation({ summary: 'Get a view aggregates' })
  @ApiOkResponse({
    description: 'View Aggregation',
    type: ApiResponse<IViewAggregationVo>,
  })
  async getViewAggregations(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Query(new ZodValidationPipe(viewAggregationRo)) query?: IViewAggregationRo
  ): Promise<ApiResponse<IViewAggregationVo>> {
    const result = await this.aggregationOpenApiService.getViewAggregations(tableId, viewId, query);
    return responseWrap(result);
  }

  @Get(':viewId/rowCount')
  @ApiOperation({ summary: 'Get a view total record size' })
  @ApiOkResponse({
    description: 'View Row Count',
    type: ApiResponse<IViewRowCountVo>,
  })
  async getViewRowCount(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<ApiResponse<IViewRowCountVo>> {
    const result = await this.aggregationOpenApiService.getViewRowCount(tableId, viewId);
    return responseWrap(result);
  }
}
