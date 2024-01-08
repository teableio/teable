import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { IAggregationVo, IRowCountVo } from '@teable-group/core';
import {
  aggregationRoSchema,
  IAggregationRo,
  IRowCountRo,
  rowCountRoSchema,
} from '@teable-group/core';
import type { User as UserModel } from '@teable-group/db-main-prisma';
import { Request } from 'express';
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
    @Req() req: Request,
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(aggregationRoSchema)) query?: IAggregationRo
  ): Promise<IAggregationVo> {
    const { id: userId } = req.user as UserModel;
    return await this.aggregationOpenApiService.getAggregation(tableId, {
      ...query,
      withUserId: userId,
    });
  }

  @Get('/rowCount')
  @Permissions('table|read')
  async getRowCount(
    @Req() req: Request,
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(rowCountRoSchema), RecordPipe) query?: IRowCountRo
  ): Promise<IRowCountVo> {
    const { id: userId } = req.user as UserModel;
    return await this.aggregationOpenApiService.getRowCount(tableId, {
      ...query,
      withUserId: userId,
    });
  }
}
