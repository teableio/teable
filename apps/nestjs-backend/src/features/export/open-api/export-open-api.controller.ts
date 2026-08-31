import { Controller, Get, UseGuards, UseInterceptors, Param, Res, Query } from '@nestjs/common';
import { type IExportCsvRo, exportCsvRoSchema } from '@teable/openapi';
import { Response } from 'express';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../../auth/guard/permission.guard';
import { UseV2Feature } from '../../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../../canary/guards/v2-feature.guard';
import { V2IndicatorInterceptor } from '../../canary/interceptors/v2-indicator.interceptor';
import { ExportOpenApiService } from './export-open-api.service';

@Controller('api/export')
@UseGuards(PermissionGuard, V2FeatureGuard)
@UseInterceptors(V2IndicatorInterceptor)
export class ExportOpenApiController {
  constructor(private readonly exportOpenService: ExportOpenApiService) {}
  @Get(':tableId')
  @UseV2Feature('exportCsv')
  @Permissions('table|export', 'view|read')
  async exportCsvFromTable(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(exportCsvRoSchema)) query: IExportCsvRo,
    @Res({ passthrough: true }) response: Response
  ): Promise<void> {
    return await this.exportOpenService.exportCsvFromTable(response, tableId, query);
  }
}
