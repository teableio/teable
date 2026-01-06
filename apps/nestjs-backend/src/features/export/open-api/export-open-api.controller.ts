import { Controller, Get, UseGuards, Param, Res, Query } from '@nestjs/common';
import { type IExportCsvRo, exportCsvRoSchema } from '@teable/openapi';
import { Response } from 'express';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../../auth/guard/permission.guard';
import { ExportOpenApiService } from './export-open-api.service';

@Controller('api/export')
@UseGuards(PermissionGuard)
export class ExportOpenApiController {
  constructor(private readonly exportOpenService: ExportOpenApiService) {}
  @Get(':tableId')
  @Permissions('table|export', 'view|read')
  async exportCsvFromTable(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(exportCsvRoSchema)) query: IExportCsvRo,
    @Res({ passthrough: true }) response: Response
  ): Promise<void> {
    return await this.exportOpenService.exportCsvFromTable(response, tableId, query);
  }
}
