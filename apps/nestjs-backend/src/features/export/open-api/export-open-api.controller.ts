import { Controller, Get, UseGuards, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../../auth/guard/permission.guard';
import { ExportOpenApiService } from './export-open-api.service';

@Controller('api/export')
@UseGuards(PermissionGuard)
export class ExportController {
  constructor(private readonly exportOpenService: ExportOpenApiService) {}
  @Get(':tableId')
  @Permissions('table|export')
  async exportCsvFromTable(
    @Param('tableId') tableId: string,
    @Res({ passthrough: true }) response: Response
  ): Promise<void> {
    return await this.exportOpenService.exportCsvFromTable(tableId, response);
  }
}
