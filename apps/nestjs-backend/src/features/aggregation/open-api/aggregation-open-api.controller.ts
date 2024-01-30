/* eslint-disable sonarjs/no-duplicate-string */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { IAggregationVo, IGroupPointsVo, IRowCountVo } from '@teable-group/core';
import {
  aggregationRoSchema,
  IGroupPointsRo,
  groupPointsRoSchema,
  IAggregationRo,
  queryBaseSchema,
  IQueryBaseRo,
} from '@teable-group/core';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { TqlPipe } from '../../record/open-api/tql.pipe';
import { AggregationOpenApiService } from './aggregation-open-api.service';

@Controller('api/table/:tableId/aggregation')
export class AggregationOpenApiController {
  constructor(private readonly aggregationOpenApiService: AggregationOpenApiService) {}

  @Get()
  @Permissions('table|read')
  async getAggregation(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(aggregationRoSchema), TqlPipe) query?: IAggregationRo
  ): Promise<IAggregationVo> {
    return await this.aggregationOpenApiService.getAggregation(tableId, query);
  }

  @Get('/row-count')
  @Permissions('table|read')
  async getRowCount(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(queryBaseSchema), TqlPipe) query?: IQueryBaseRo
  ): Promise<IRowCountVo> {
    return await this.aggregationOpenApiService.getRowCount(tableId, query);
  }

  @Get('/group-points')
  @Permissions('table|read')
  async getGroupPoints(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(groupPointsRoSchema), TqlPipe) query?: IGroupPointsRo
  ): Promise<IGroupPointsVo> {
    return await this.aggregationOpenApiService.getGroupPoints(tableId, query);
  }
}
