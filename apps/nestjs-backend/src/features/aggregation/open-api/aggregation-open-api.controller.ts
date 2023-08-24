import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  aggFuncSchema,
  FieldKeyType,
  fieldKeyTypeRoSchema,
  StatisticsFunc,
} from '@teable-group/core';
import type { IAggregationsValue, IViewAggregationVo } from '@teable-group/core';
import { ApiResponse, responseWrap } from '../../../utils';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
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

  @Get(':viewId/:fieldIdOrName/:func')
  @ApiOperation({ summary: 'Get a specify aggregation from view by field and func name' })
  @ApiOkResponse({
    type: ApiResponse<IAggregationsValue>,
  })
  async getViewAggregatesByFunc(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Param('fieldIdOrName') fieldIdOrName: string,
    @Param('func', new ZodValidationPipe(aggFuncSchema)) func: StatisticsFunc,
    @Query('fieldKeyType', new ZodValidationPipe(fieldKeyTypeRoSchema)) fieldKeyType?: FieldKeyType
  ): Promise<ApiResponse<IAggregationsValue>> {
    const result = await this.aggregationService.calculateSpecifyAggregation(
      tableId,
      fieldIdOrName,
      viewId,
      func,
      fieldKeyType
    );
    return responseWrap(result);
  }
}
