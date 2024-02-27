/* eslint-disable sonarjs/no-duplicate-string */
import { Controller, Get, UseGuards, Query, Post, Body, Param } from '@nestjs/common';
import type { IAnalyzeVo, ITableFullVo } from '@teable/core';
import { analyzeRoSchema, IAnalyzeRo, IImportOptionRo, importOptionRoSchema } from '@teable/core';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { PermissionGuard } from '../../auth/guard/permission.guard';
import { ImportOpenApiService } from './import-open-api.service';

@Controller('api/import')
@UseGuards(PermissionGuard)
export class ImportController {
  constructor(private readonly importOpenService: ImportOpenApiService) {}
  @Get('/analyze')
  async analyzeSheetFromFile(
    @Query(new ZodValidationPipe(analyzeRoSchema)) analyzeRo: IAnalyzeRo
  ): Promise<IAnalyzeVo> {
    return await this.importOpenService.analyze(analyzeRo);
  }

  @Post(':baseId')
  async createTableFromImport(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(importOptionRoSchema)) importRo: IImportOptionRo
  ): Promise<ITableFullVo> {
    return await this.importOpenService.createTableFromImport(baseId, importRo);
  }
}
