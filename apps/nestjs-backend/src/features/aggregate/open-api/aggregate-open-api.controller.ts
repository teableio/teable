/* eslint-disable @typescript-eslint/naming-convention */
import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IViewAggregateVo } from '@teable-group/core';
import { AggregateService } from 'src/features/aggregate/aggregate.service';
import { ApiResponse, responseWrap } from '../../../utils';

@ApiBearerAuth()
@ApiTags('aggregate')
@Controller('api/table/:tableId/aggregate')
export class AggregateOpenApiController {
  constructor(private readonly aggregateService: AggregateService) {}

  @Get(':viewId')
  @ApiOperation({ summary: 'Get a view aggregates' })
  @ApiOkResponse({
    description: 'View',
    type: ApiResponse<IViewAggregateVo>,
  })
  async getViewAggregates(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<ApiResponse<IViewAggregateVo>> {
    const result = await this.aggregateService.calculateAggregates({
      tableId,
      withView: { viewId },
    });
    return responseWrap(result);
  }
}
