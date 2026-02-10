import {
  Controller,
  Get,
  UseGuards,
  Query,
  Post,
  Body,
  Param,
  Patch,
  UseInterceptors,
} from '@nestjs/common';
import {
  analyzeRoSchema,
  IAnalyzeRo,
  IImportOptionRo,
  importOptionRoSchema,
  IInplaceImportOptionRo,
  inplaceImportOptionRoSchema,
} from '@teable/openapi';
import type { ITableFullVo, IAnalyzeVo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { TokenAccess } from '../../auth/decorators/token.decorator';
import { PermissionGuard } from '../../auth/guard/permission.guard';
import { UseV2Feature } from '../../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../../canary/guards/v2-feature.guard';
import { V2IndicatorInterceptor } from '../../canary/interceptors/v2-indicator.interceptor';
import { ImportOpenApiV2Service } from './import-open-api-v2.service';
import { ImportOpenApiService } from './import-open-api.service';

@Controller('api/import')
@UseGuards(PermissionGuard, V2FeatureGuard)
@UseInterceptors(V2IndicatorInterceptor)
export class ImportController {
  constructor(
    protected readonly importOpenService: ImportOpenApiService,
    protected readonly importOpenApiV2Service: ImportOpenApiV2Service,
    protected readonly cls: ClsService<IClsStore>
  ) {}
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

  @UseV2Feature('importRecords')
  @Patch(':baseId/:tableId')
  @Permissions('table|import')
  async inplaceImportTable(
    @Param('baseId') baseId: string,
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(inplaceImportOptionRoSchema))
    inplaceImportRo: IInplaceImportOptionRo
  ): Promise<void> {
    // Use V2 logic when canary config enables it for this space + feature
    if (this.cls.get('useV2')) {
      await this.importOpenApiV2Service.importRecords(baseId, tableId, inplaceImportRo);
      return;
    }

    return await this.importOpenService.inplaceImportTable(baseId, tableId, inplaceImportRo);
  }
}
