/* eslint-disable sonarjs/no-duplicate-string */
import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Optional,
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
  getFieldsQuerySchema,
  IFieldRo,
  IGetFieldsQuery,
  IConvertFieldRo,
  convertFieldRoSchema,
  updateFieldRoSchema,
  IUpdateFieldRo,
} from '@teable/core';
import {
  createFieldRequestSchema,
  deleteFieldsQuerySchema,
  fieldDeleteReferencesQuerySchema,
  IAutoFillFieldRo,
  autoFillFieldRoSchema,
  duplicateFieldRoSchema,
  IDeleteFieldsQuery,
  IDuplicateFieldRo,
  updateFieldPeriodicRefreshRoSchema,
  IUpdateFieldPeriodicRefreshRo,
} from '@teable/openapi';
import type {
  IAutoFillFieldVo,
  IFieldDeleteReferencesQuery,
  IFieldDeleteReferencesVo,
  IGetViewFilterLinkRecordsVo,
  IPlanFieldConvertVo,
  IPlanFieldVo,
  ITriggerFieldPeriodicRefreshVo,
  IUpdateFieldPeriodicRefreshVo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { AllowAnonymous } from '../../auth/decorators/allow-anonymous.decorator';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UseV2Feature } from '../../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../../canary/guards/v2-feature.guard';
import { V2IndicatorInterceptor } from '../../canary/interceptors/v2-indicator.interceptor';
import { FieldPeriodicRefreshService } from '../../field-periodic-refresh/field-periodic-refresh.service';
import { TableIndexService } from '../../table-index/table-index.service';
import { FieldService } from '../field.service';
import { FieldDependencyReadService } from './field-dependency-read.service';
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
    private readonly tableIndexService: TableIndexService,
    private readonly fieldDependencyReadService: FieldDependencyReadService,
    private readonly cls: ClsService<IClsStore>,
    @Optional()
    protected readonly fieldPeriodicRefreshService?: FieldPeriodicRefreshService
  ) {}

  @Permissions('field|delete')
  @UseV2Feature('getFields')
  @Get('delete-references')
  async getDeleteFieldReferences(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(fieldDeleteReferencesQuerySchema))
    query: IFieldDeleteReferencesQuery
  ): Promise<IFieldDeleteReferencesVo> {
    if (this.cls.get('useV2')) {
      return this.fieldDependencyReadService.getDeleteFieldReferences(tableId, query.fieldIds);
    }
    return this.fieldOpenApiService.getDeleteFieldReferences(tableId, query.fieldIds);
  }

  @Permissions('field|read')
  @UseV2Feature('getFields')
  @Get(':fieldId/plan')
  async planField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string
  ): Promise<IPlanFieldVo> {
    if (this.cls.get('useV2')) {
      return this.fieldDependencyReadService.planField(tableId, fieldId);
    }
    return await this.fieldOpenApiService.planField(tableId, fieldId);
  }

  @Permissions('field|read')
  @UseV2Feature('getFields')
  @Get(':fieldId')
  async getField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string
  ): Promise<IFieldVo> {
    if (this.cls.get('useV2')) {
      return await this.fieldOpenApiV2Service.getField(tableId, fieldId);
    }
    return await this.fieldService.getField(tableId, fieldId);
  }

  @Permissions('field|read')
  @UseV2Feature('getFields')
  @Get()
  async getFields(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getFieldsQuerySchema)) query: IGetFieldsQuery
  ): Promise<IFieldVo[]> {
    if (this.cls.get('useV2')) {
      return await this.fieldOpenApiV2Service.getFields(tableId, query);
    }
    return await this.fieldOpenApiService.getFields(tableId, query);
  }

  @Permissions('field|create')
  @UseV2Feature('createField')
  @Post('/plan')
  async planFieldCreate(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(createFieldRequestSchema)) fieldRo: IFieldRo
  ): Promise<IPlanFieldVo> {
    if (this.cls.get('useV2')) {
      return await this.fieldOpenApiV2Service.planFieldCreate(tableId, fieldRo);
    }
    return await this.fieldOpenApiService.planFieldCreate(tableId, fieldRo);
  }

  @Permissions('field|create')
  @UseV2Feature('createField')
  @Post()
  async createField(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(createFieldRequestSchema)) fieldRo: IFieldRo,
    @Headers('x-window-id') windowId: string
  ): Promise<IFieldVo> {
    if (this.cls.get('useV2')) {
      return await this.fieldOpenApiV2Service.createField(tableId, fieldRo);
    }
    return await this.fieldOpenApiService.createField(tableId, fieldRo, windowId);
  }

  @Permissions('field|update')
  @UseV2Feature('convertField')
  @Put(':fieldId/plan')
  async planFieldConvert(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(convertFieldRoSchema)) updateFieldRo: IConvertFieldRo
  ): Promise<IPlanFieldConvertVo> {
    if (this.cls.get('useV2')) {
      return await this.fieldOpenApiV2Service.planFieldConvert(tableId, fieldId, updateFieldRo);
    }
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
  @UseV2Feature('deleteField')
  @Delete(':fieldId/plan')
  async planDeleteField(@Param('tableId') tableId: string, @Param('fieldId') fieldId: string) {
    if (this.cls.get('useV2')) {
      return this.fieldDependencyReadService.planDeleteField(tableId, fieldId);
    }
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
      await this.tableIndexService.removeQueryIndexesForFieldStandalone(tableId, fieldId);
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
      await this.fieldOpenApiV2Service.deleteFields(tableId, query.fieldIds);
      for (const fieldId of query.fieldIds) {
        await this.tableIndexService.removeQueryIndexesForFieldStandalone(tableId, fieldId);
      }
      return;
    }
    await this.fieldOpenApiService.deleteFields(tableId, query.fieldIds, windowId);
  }

  @Permissions('field|update')
  @UseV2Feature('getViewFilterLinkRecords')
  @Get('/:fieldId/filter-link-records')
  async getFilterLinkRecords(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string
  ): Promise<IGetViewFilterLinkRecordsVo> {
    if (this.cls.get('useV2')) {
      return this.fieldOpenApiV2Service.getFilterLinkRecords(tableId, fieldId);
    }
    return this.fieldOpenApiService.getFilterLinkRecords(tableId, fieldId);
  }

  @Permissions('field|read')
  @UseV2Feature('getFields')
  @Get('/socket/snapshot-bulk')
  async getSnapshotBulk(@Param('tableId') tableId: string, @Query('ids') ids: string[]) {
    if (this.cls.get('useV2')) {
      return this.fieldOpenApiV2Service.getSnapshotBulk(tableId, ids);
    }
    return this.fieldService.getSnapshotBulk(tableId, ids);
  }

  @Permissions('field|read')
  @UseV2Feature('getFields')
  @Get('/socket/doc-ids')
  async getDocIds(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getFieldsQuerySchema)) query: IGetFieldsQuery
  ) {
    if (this.cls.get('useV2')) {
      const fields = await this.fieldOpenApiV2Service.getFields(tableId, query);
      return { ids: fields.map((field) => field.id) };
    }
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

  @Permissions('record|update')
  @Post('/:fieldId/periodic-refresh')
  async triggerPeriodicRefresh(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string
  ): Promise<ITriggerFieldPeriodicRefreshVo> {
    if (!this.fieldPeriodicRefreshService) {
      throw new NotFoundException('Periodic refresh service unavailable');
    }
    return this.fieldPeriodicRefreshService.triggerRefresh({
      tableId,
      fieldId,
      trigger: 'manual',
    });
  }

  @Permissions('field|update')
  @Patch('/:fieldId/periodic-refresh')
  async updatePeriodicRefresh(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(updateFieldPeriodicRefreshRoSchema))
    body: IUpdateFieldPeriodicRefreshRo
  ): Promise<IUpdateFieldPeriodicRefreshVo> {
    if (!this.fieldPeriodicRefreshService) {
      throw new NotFoundException('Periodic refresh service unavailable');
    }
    return this.fieldPeriodicRefreshService.updatePeriodicRefresh(tableId, fieldId, body);
  }
}
