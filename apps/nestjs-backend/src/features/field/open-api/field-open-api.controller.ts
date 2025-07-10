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
  IAutoFillFieldRo,
  autoFillFieldRoSchema,
  duplicateFieldRoSchema,
  IDeleteFieldsQuery,
  IDuplicateFieldRo,
} from '@teable/openapi';
import type {
  IAutoFillFieldVo,
  IGetViewFilterLinkRecordsVo,
  IPlanFieldConvertVo,
  IPlanFieldVo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { FieldService } from '../field.service';
import { FieldOpenApiService } from './field-open-api.service';

@Controller('api/table/:tableId/field')
export class FieldOpenApiController {
  constructor(
    private readonly fieldService: FieldService,
    private readonly fieldOpenApiService: FieldOpenApiService
  ) {}

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
  @Post()
  async createField(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(createFieldRoSchema)) fieldRo: IFieldRo,
    @Headers('x-window-id') windowId: string
  ): Promise<IFieldVo> {
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
  @Put(':fieldId/convert')
  async convertField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(convertFieldRoSchema)) updateFieldRo: IConvertFieldRo,
    @Headers('x-window-id') windowId: string
  ) {
    return await this.fieldOpenApiService.convertField(tableId, fieldId, updateFieldRo, windowId);
  }

  @Permissions('field|update')
  @Patch(':fieldId')
  async updateField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(updateFieldRoSchema)) updateFieldRo: IUpdateFieldRo
  ) {
    return await this.fieldOpenApiService.updateField(tableId, fieldId, updateFieldRo);
  }

  @Permissions('field|delete')
  @Delete(':fieldId/plan')
  async planDeleteField(@Param('tableId') tableId: string, @Param('fieldId') fieldId: string) {
    return await this.fieldOpenApiService.planDeleteField(tableId, fieldId);
  }

  @Permissions('field|delete')
  @Delete(':fieldId')
  async deleteField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Headers('x-window-id') windowId: string
  ) {
    await this.fieldOpenApiService.deleteField(tableId, fieldId, windowId);
  }

  @Permissions('field|delete')
  @Delete()
  async deleteFields(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(deleteFieldsQuerySchema)) query: IDeleteFieldsQuery,
    @Headers('x-window-id') windowId: string
  ) {
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
  @Post('/:fieldId/duplicate')
  async duplicateField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(duplicateFieldRoSchema)) duplicateFieldRo: IDuplicateFieldRo,
    @Headers('x-window-id') windowId: string
  ) {
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
