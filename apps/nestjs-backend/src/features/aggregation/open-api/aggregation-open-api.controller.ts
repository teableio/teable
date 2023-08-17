import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IViewAggregationVo } from '@teable-group/core';
import { ApiResponse, responseWrap } from '../../../utils';
import { AggregationService } from '../aggregation.service';

@ApiBearerAuth()
@ApiTags('aggregation')
@Controller('api/table/:tableId/aggregation')
export class AggregationOpenApiController {
  constructor(private readonly aggregationService: AggregationService) {}

  @Get(':viewId')
  @ApiOperation({ summary: 'Get a view aggregates' })
  @ApiOkResponse({
    description: 'View',
    type: ApiResponse<IViewAggregationVo>,
  })
  async getViewAggregates(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<ApiResponse<IViewAggregationVo>> {
    const result = await this.aggregationService.calculateAggregations({
      tableId,
      withView: { viewId },
    });
    return responseWrap(result);
  }
}
