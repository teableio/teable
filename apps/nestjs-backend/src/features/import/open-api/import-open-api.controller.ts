import { Controller, Get, UseGuards, Query, Post, Body, Param, Patch } from '@nestjs/common';
import {
  analyzeRoSchema,
  IAnalyzeRo,
  IImportOptionRo,
  importOptionRoSchema,
  IInplaceImportOptionRo,
  inplaceImportOptionRoSchema,
} from '@teable/openapi';
import type { ITableFullVo, IAnalyzeVo } from '@teable/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { TokenAccess } from '../../auth/decorators/token.decorator';
import { PermissionGuard } from '../../auth/guard/permission.guard';

import { ImportOpenApiService } from './import-open-api.service';

@Controller('api/import')
@UseGuards(PermissionGuard)
export class ImportController {
  constructor(private readonly importOpenService: ImportOpenApiService) {}
  @Get('/analyze')
  @TokenAccess()
  async analyzeSheetFromFile(
    @Query(new ZodValidationPipe(analyzeRoSchema)) analyzeRo: IAnalyzeRo
  ): Promise<IAnalyzeVo> {
    return await this.importOpenService.analyze(analyzeRo);
  }

  @Post(':baseId')
  @Permissions('base|table_import')
  async createTableFromImport(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(importOptionRoSchema)) importRo: IImportOptionRo
  ): Promise<ITableFullVo[]> {
    return await this.importOpenService.createTableFromImport(baseId, importRo);
  }

  @Patch(':baseId/:tableId')
  @Permissions('table|import')
  async inplaceImportTable(
    @Param('baseId') baseId: string,
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(inplaceImportOptionRoSchema))
    inplaceImportRo: IInplaceImportOptionRo
  ): Promise<void> {
    return await this.importOpenService.inplaceImportTable(baseId, tableId, inplaceImportRo);
  }
}
