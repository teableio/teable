/* eslint-disable sonarjs/no-duplicate-string */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { IAggregationVo, IGroupPointsVo, IRowCountVo } from '@teable-group/core';
import {
  IAggregationRo,
  aggregationRoSchema,
  rowCountRoSchema,
  IRowCountRo,
  IGroupPointsRo,
  groupPointsRoSchema,
} from '@teable-group/core';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../../auth/guard/permission.guard';
import { RecordPipe } from '../../record/open-api/record.pipe';
import { AggregationOpenApiService } from './aggregation-open-api.service';

@Controller('api/table/:tableId/aggregation')
@UseGuards(PermissionGuard)
export class AggregationOpenApiController {
  constructor(private readonly aggregationOpenApiService: AggregationOpenApiService) {}

  @Get()
  @Permissions('table|read')
  async getAggregation(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(aggregationRoSchema)) query?: IAggregationRo
  ): Promise<IAggregationVo> {
    return await this.aggregationOpenApiService.getAggregation(tableId, query);
  }

  @Get('/rowCount')
  @Permissions('table|read')
  async getRowCount(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(rowCountRoSchema), RecordPipe) query?: IRowCountRo
  ): Promise<IRowCountVo> {
    return await this.aggregationOpenApiService.getRowCount(tableId, query);
  }

  @Get('/groupPoints')
  @Permissions('table|read')
  async getGroupPoints(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(groupPointsRoSchema), RecordPipe) query?: IGroupPointsRo
  ): Promise<IGroupPointsVo> {
    return await this.aggregationOpenApiService.getGroupPoints(tableId, query);
  }
}
