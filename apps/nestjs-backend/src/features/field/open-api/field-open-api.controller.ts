/* eslint-disable sonarjs/no-duplicate-string */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  Post,
  Query,
  Headers,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { IFieldVo } from '@teable/core';
import {
  createFieldRoSchema,
  getFieldsQuerySchema,
  IFieldRo,
  IGetFieldsQuery,
  IConvertFieldRo,
  convertFieldRoSchema,
  updateFieldRoSchema,
  IUpdateFieldRo,
} from '@teable/core';
import {
  deleteFieldsQuerySchema,
  fieldDeleteReferencesQuerySchema,
  IAutoFillFieldRo,
  autoFillFieldRoSchema,
  duplicateFieldRoSchema,
  IDeleteFieldsQuery,
  IDuplicateFieldRo,
} from '@teable/openapi';
import type {
  IAutoFillFieldVo,
  IFieldDeleteReferencesQuery,
  IFieldDeleteReferencesVo,
  IGetViewFilterLinkRecordsVo,
  IPlanFieldConvertVo,
  IPlanFieldVo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { AllowAnonymous } from '../../auth/decorators/allow-anonymous.decorator';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UseV2Feature } from '../../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../../canary/guards/v2-feature.guard';
import { V2IndicatorInterceptor } from '../../canary/interceptors/v2-indicator.interceptor';
import { FieldService } from '../field.service';
import { FieldOpenApiV2Service } from './field-open-api-v2.service';
import { FieldOpenApiService } from './field-open-api.service';

@UseGuards(V2FeatureGuard)
@UseInterceptors(V2IndicatorInterceptor)
@Controller('api/table/:tableId/field')
@AllowAnonymous()
export class FieldOpenApiController {
  constructor(
    private readonly fieldService: FieldService,
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly fieldOpenApiV2Service: FieldOpenApiV2Service,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Permissions('field|delete')
  @Get('delete-references')
  async getDeleteFieldReferences(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(fieldDeleteReferencesQuerySchema))
    query: IFieldDeleteReferencesQuery
  ): Promise<IFieldDeleteReferencesVo> {
    return this.fieldOpenApiService.getDeleteFieldReferences(tableId, query.fieldIds);
  }

  @Permissions('field|read')
  @Get(':fieldId/plan')
  async planField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string
  ): Promise<IPlanFieldVo> {
    return await this.fieldOpenApiService.planField(tableId, fieldId);
  }

  @Permissions('field|read')
  @Get(':fieldId')
  async getField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string
  ): Promise<IFieldVo> {
    const forceV2All = process.env.FORCE_V2_ALL?.toLowerCase() === 'true';
    if (this.cls.get('useV2') || forceV2All) {
      const field = await this.fieldOpenApiV2Service.getField(tableId, fieldId);
      if (field.hasError == null) {
        try {
          const legacyField = await this.fieldService.getField(tableId, fieldId);
          if (legacyField.hasError != null) {
            field.hasError = legacyField.hasError;
          }
        } catch (error) {
          void error;
        }
      }
      return field;
    }
    return await this.fieldService.getField(tableId, fieldId);
  }

  @Permissions('field|read')
  @Get()
  async getFields(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getFieldsQuerySchema)) query: IGetFieldsQuery
  ): Promise<IFieldVo[]> {
    return await this.fieldOpenApiService.getFields(tableId, query);
  }

  @Permissions('field|create')
  @Post('/plan')
  async planFieldCreate(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(createFieldRoSchema)) fieldRo: IFieldRo
  ): Promise<IPlanFieldVo> {
    return await this.fieldOpenApiService.planFieldCreate(tableId, fieldRo);
  }

  @Permissions('field|create')
  @UseV2Feature('createField')
  @Post()
  async createField(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(createFieldRoSchema)) fieldRo: IFieldRo,
    @Headers('x-window-id') windowId: string
  ): Promise<IFieldVo> {
    if (this.cls.get('useV2')) {
      return await this.fieldOpenApiV2Service.createField(tableId, fieldRo);
    }
    return await this.fieldOpenApiService.createField(tableId, fieldRo, windowId);
  }

  @Permissions('field|update')
  @Put(':fieldId/plan')
  async planFieldConvert(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(convertFieldRoSchema)) updateFieldRo: IConvertFieldRo
  ): Promise<IPlanFieldConvertVo> {
    return await this.fieldOpenApiService.planFieldConvert(tableId, fieldId, updateFieldRo);
  }

  @Permissions('field|update')
  @UseV2Feature('convertField')
  @Put(':fieldId/convert')
  async convertField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(convertFieldRoSchema)) updateFieldRo: IConvertFieldRo,
    @Headers('x-window-id') windowId: string
  ) {
    if (this.cls.get('useV2')) {
      return await this.fieldOpenApiV2Service.convertField(tableId, fieldId, updateFieldRo, {
        emitOperation: Boolean(windowId),
        suppressWindowId: !windowId,
      });
    }
    return await this.fieldOpenApiService.convertField(tableId, fieldId, updateFieldRo, windowId);
  }

  @Permissions('field|update')
  @UseV2Feature('updateField')
  @Patch(':fieldId')
  async updateField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(updateFieldRoSchema)) updateFieldRo: IUpdateFieldRo
  ) {
    if (this.cls.get('useV2')) {
      return await this.fieldOpenApiV2Service.updateField(tableId, fieldId, updateFieldRo);
    }
    return await this.fieldOpenApiService.updateField(tableId, fieldId, updateFieldRo);
  }

  @Permissions('field|delete')
  @Delete(':fieldId/plan')
  async planDeleteField(@Param('tableId') tableId: string, @Param('fieldId') fieldId: string) {
    return await this.fieldOpenApiService.planDeleteField(tableId, fieldId);
  }

  @Permissions('field|delete')
  @UseV2Feature('deleteField')
  @Delete(':fieldId')
  async deleteField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Headers('x-window-id') windowId: string
  ) {
    if (this.cls.get('useV2')) {
      await this.fieldOpenApiV2Service.deleteField(tableId, fieldId);
      return;
    }
    await this.fieldOpenApiService.deleteField(tableId, fieldId, windowId);
  }

  @Permissions('field|delete')
  @UseV2Feature('deleteField')
  @Delete()
  async deleteFields(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(deleteFieldsQuerySchema)) query: IDeleteFieldsQuery,
    @Headers('x-window-id') windowId: string
  ) {
    if (this.cls.get('useV2')) {
      for (const fieldId of query.fieldIds) {
        await this.fieldOpenApiV2Service.deleteField(tableId, fieldId);
      }
      return;
    }
    await this.fieldOpenApiService.deleteFields(tableId, query.fieldIds, windowId);
  }

  @Permissions('field|update')
  @Get('/:fieldId/filter-link-records')
  async getFilterLinkRecords(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string
  ): Promise<IGetViewFilterLinkRecordsVo> {
    return this.fieldOpenApiService.getFilterLinkRecords(tableId, fieldId);
  }

  @Permissions('field|read')
  @Get('/socket/snapshot-bulk')
  async getSnapshotBulk(@Param('tableId') tableId: string, @Query('ids') ids: string[]) {
    return this.fieldService.getSnapshotBulk(tableId, ids);
  }

  @Permissions('field|read')
  @Get('/socket/doc-ids')
  async getDocIds(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getFieldsQuerySchema)) query: IGetFieldsQuery
  ) {
    return this.fieldService.getDocIdsByQuery(tableId, query);
  }

  @Permissions('field|create')
  @UseV2Feature('duplicateField')
  @Post('/:fieldId/duplicate')
  async duplicateField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(duplicateFieldRoSchema)) duplicateFieldRo: IDuplicateFieldRo,
    @Headers('x-window-id') windowId: string
  ) {
    if (this.cls.get('useV2')) {
      return this.fieldOpenApiV2Service.duplicateField(
        tableId,
        fieldId,
        duplicateFieldRo,
        windowId
      );
    }
    return this.fieldOpenApiService.duplicateField(tableId, fieldId, duplicateFieldRo, windowId);
  }

  @Permissions('record|update')
  @Post('/:fieldId/auto-fill')
  async autoFillField(
    @Param('tableId') _tableId: string,
    @Param('fieldId') _fieldId: string,
    @Body(new ZodValidationPipe(autoFillFieldRoSchema)) _query: IAutoFillFieldRo
  ): Promise<IAutoFillFieldVo> {
    return { taskId: null };
  }

  @Permissions('record|update')
  @Post('/:fieldId/stop-fill')
  async stopFillField(@Param('tableId') _tableId: string, @Param('fieldId') _fieldId: string) {
    return null;
  }
}
