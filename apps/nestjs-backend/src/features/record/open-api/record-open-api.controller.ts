/* eslint-disable sonarjs/no-duplicate-string */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PrismaService } from '@teable/db-main-prisma';
import {
  createRecordsRoSchema,
  getRecordQuerySchema,
  getRecordsRoSchema,
  updateRecordRoSchema,
  deleteRecordsQuerySchema,
  getRecordHistoryQuerySchema,
  updateRecordsRoSchema,
  recordInsertOrderRoSchema,
  recordGetCollaboratorsRoSchema,
  formSubmitRoSchema,
  optionalRecordOrderSchema,
  insertAttachmentRoSchema,
} from '@teable/openapi';
import type {
  IAutoFillCellVo,
  IButtonClickVo,
  ICreateRecordsVo,
  IRecord,
  IRecordGetCollaboratorsVo,
  IRecordStatusVo,
  IRecordsVo,
  ICreateRecordsRo,
  IDeleteRecordsQuery,
  IGetRecordQuery,
  IGetRecordHistoryQuery,
  IGetRecordsRo,
  IRecordGetCollaboratorsRo,
  IRecordInsertOrderRo,
  IUpdateRecordRo,
  IUpdateRecordsRo,
  IFormSubmitRo,
  IInsertAttachmentRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { EmitControllerEvent } from '../../../event-emitter/decorators/emit-controller-event.decorator';
import { Events } from '../../../event-emitter/events';
import { PerformanceCacheService } from '../../../performance-cache';
import { generateRecordCacheKey } from '../../../performance-cache/generate-keys';
import type { IClsStore } from '../../../types/cls';
import { filterHasMe } from '../../../utils/filter-has-me';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { AllowAnonymous } from '../../auth/decorators/allow-anonymous.decorator';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UseV2Feature } from '../../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../../canary/guards/v2-feature.guard';
import { V2IndicatorInterceptor } from '../../canary/interceptors/v2-indicator.interceptor';
import { RecordService } from '../record.service';
import { FieldKeyPipe } from './field-key.pipe';
import { RecordOpenApiV2Service } from './record-open-api-v2.service';
import { RecordOpenApiService } from './record-open-api.service';
import { TqlPipe } from './tql.pipe';

@UseGuards(V2FeatureGuard)
@UseInterceptors(V2IndicatorInterceptor)
@Controller('api/table/:tableId/record')
@AllowAnonymous()
export class RecordOpenApiController {
  constructor(
    private readonly recordService: RecordService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly performanceCacheService: PerformanceCacheService,
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly recordOpenApiV2Service: RecordOpenApiV2Service
  ) {}

  @Permissions('record|update')
  @Get(':recordId/history')
  async getRecordHistory(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Query(new ZodValidationPipe(getRecordHistoryQuerySchema)) query: IGetRecordHistoryQuery
  ) {
    return this.recordOpenApiService.getRecordHistory(tableId, recordId, query);
  }

  @Permissions('table_record_history|read')
  @Get('/history')
  async getRecordListHistory(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getRecordHistoryQuerySchema)) query: IGetRecordHistoryQuery
  ) {
    return this.recordOpenApiService.getRecordHistory(tableId, undefined, query);
  }

  @Permissions('record|read')
  @Get('collaborators')
  async getCollaborators(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(recordGetCollaboratorsRoSchema)) query: IRecordGetCollaboratorsRo
  ): Promise<IRecordGetCollaboratorsVo> {
    return this.recordService.getRecordsCollaborators(tableId, query);
  }

  @Permissions('record|read')
  @Get()
  async getRecords(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getRecordsRoSchema), TqlPipe, FieldKeyPipe) query: IGetRecordsRo
  ): Promise<IRecordsVo> {
    return await this.recordService.getRecords(tableId, query, true);
  }

  @Permissions('record|read')
  @Get(':recordId')
  async getRecord(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Query(new ZodValidationPipe(getRecordQuerySchema)) query: IGetRecordQuery
  ): Promise<IRecord> {
    return await this.recordService.getRecord(tableId, recordId, query, true, true);
  }

  @UseV2Feature('updateRecord')
  @Permissions('record|update')
  @Patch(':recordId')
  async updateRecord(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Body(new ZodValidationPipe(updateRecordRoSchema)) updateRecordRo: IUpdateRecordRo,
    @Headers('x-window-id') windowId?: string,
    @Headers('x-ai-internal') isAiInternal?: string
  ): Promise<IRecord> {
    // Use V2 logic when canary config enables it for this space + feature
    if (this.cls.get('useV2')) {
      return this.recordOpenApiV2Service.updateRecord(
        tableId,
        recordId,
        updateRecordRo,
        windowId,
        isAiInternal
      );
    }

    return await this.recordOpenApiService.updateRecord(
      tableId,
      recordId,
      updateRecordRo,
      windowId,
      isAiInternal
    );
  }

  @Permissions('record|update')
  @Post(':recordId/:fieldId/uploadAttachment')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Param('fieldId') fieldId: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body('fileUrl') fileUrl?: string
  ): Promise<IRecord> {
    return await this.recordOpenApiService.uploadAttachment(
      tableId,
      recordId,
      fieldId,
      file,
      fileUrl
    );
  }

  @Permissions('record|update')
  @Post(':recordId/:fieldId/insertAttachment')
  async insertAttachment(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(insertAttachmentRoSchema)) body: IInsertAttachmentRo
  ): Promise<IRecord> {
    return await this.recordOpenApiService.insertAttachment(
      tableId,
      recordId,
      fieldId,
      body.attachments,
      body.anchorId
    );
  }

  @Permissions('record|update')
  @UseV2Feature('updateRecords')
  @Patch()
  async updateRecords(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(updateRecordsRoSchema)) updateRecordsRo: IUpdateRecordsRo,
    @Headers('x-window-id') windowId?: string,
    @Headers('x-ai-internal') isAiInternal?: string
  ): Promise<IRecord[]> {
    if (this.cls.get('useV2')) {
      return await this.recordOpenApiV2Service.updateRecords(
        tableId,
        updateRecordsRo,
        windowId,
        isAiInternal
      );
    }

    return (
      await this.recordOpenApiService.updateRecords(
        tableId,
        updateRecordsRo,
        windowId,
        isAiInternal
      )
    ).records;
  }

  @UseV2Feature('createRecord')
  @Permissions('record|create')
  @Post()
  @EmitControllerEvent(Events.OPERATION_RECORDS_CREATE)
  async createRecords(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(createRecordsRoSchema)) createRecordsRo: ICreateRecordsRo,
    @Headers('x-ai-internal') isAiInternal?: string
  ): Promise<ICreateRecordsVo> {
    // Use V2 logic when canary config enables it for this space + feature
    if (this.cls.get('useV2')) {
      return await this.recordOpenApiV2Service.createRecords(
        tableId,
        createRecordsRo,
        isAiInternal
      );
    }

    return await this.recordOpenApiService.multipleCreateRecords(
      tableId,
      createRecordsRo,
      undefined,
      isAiInternal
    );
  }

  @UseV2Feature('formSubmit')
  @Permissions('record|create')
  @Post('form-submit')
  async formSubmit(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(formSubmitRoSchema)) formSubmitRo: IFormSubmitRo
  ): Promise<IRecord> {
    if (this.cls.get('useV2')) {
      return this.recordOpenApiV2Service.formSubmit(tableId, formSubmitRo);
    }

    return await this.recordOpenApiService.formSubmit(tableId, formSubmitRo);
  }

  @UseV2Feature('duplicateRecord')
  @Permissions('record|create', 'record|read')
  @Post(':recordId/duplicate')
  @EmitControllerEvent(Events.OPERATION_RECORDS_CREATE)
  async duplicateRecord(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Body(new ZodValidationPipe(optionalRecordOrderSchema)) order?: IRecordInsertOrderRo
  ) {
    if (this.cls.get('useV2')) {
      return await this.recordOpenApiV2Service.duplicateRecord(tableId, recordId, order);
    }
    return await this.recordOpenApiService.duplicateRecord(tableId, recordId, order);
  }

  @UseV2Feature('deleteRecord')
  @Permissions('record|delete')
  @Delete(':recordId')
  async deleteRecord(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Headers('x-window-id') windowId?: string
  ): Promise<IRecord> {
    // Use V2 logic when canary config enables it for this space + feature
    if (this.cls.get('useV2')) {
      const result = await this.recordOpenApiV2Service.deleteRecords(tableId, [recordId], windowId);
      return result.records[0];
    }

    return await this.recordOpenApiService.deleteRecord(tableId, recordId, windowId);
  }

  @UseV2Feature('deleteRecord')
  @Permissions('record|delete')
  @Delete()
  async deleteRecords(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(deleteRecordsQuerySchema)) query: IDeleteRecordsQuery,
    @Headers('x-window-id') windowId?: string
  ): Promise<IRecordsVo> {
    // Use V2 logic when canary config enables it for this space + feature
    if (this.cls.get('useV2')) {
      return this.recordOpenApiV2Service.deleteRecords(tableId, query.recordIds, windowId);
    }

    return await this.recordOpenApiService.deleteRecords(tableId, query.recordIds, windowId);
  }

  @Permissions('record|read')
  @Get('/socket/snapshot-bulk')
  async getSnapshotBulk(
    @Param('tableId') tableId: string,
    @Query('ids') ids: string[],
    @Query('projection') projection?: { [fieldNameOrId: string]: boolean }
  ) {
    return this.recordService.getSnapshotBulkWithPermission(
      tableId,
      ids,
      projection,
      undefined,
      undefined,
      true
    );
  }

  @Permissions('record|read')
  @Post('/socket/doc-ids')
  async getDocIds(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(getRecordsRoSchema), TqlPipe) query: IGetRecordsRo
  ) {
    return this.getDocIdsWithCache(tableId, query);
  }

  private async getDocIdsWithCache(tableId: string, query: IGetRecordsRo) {
    const table = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        lastModifiedTime: true,
      },
    });
    const viewId = query.viewId;
    let viewFilter: string | null = null;
    if (viewId) {
      const view = await this.prismaService.view.findUniqueOrThrow({
        where: {
          id: viewId,
        },
        select: {
          filter: true,
        },
      });
      viewFilter = view.filter;
    }
    const cacheQuery =
      filterHasMe(query.filter) || filterHasMe(viewFilter)
        ? { ...query, currentUserId: this.cls.get('user.id') }
        : query;

    const cacheKey = generateRecordCacheKey(
      'doc_ids',
      tableId,
      table.lastModifiedTime?.getTime().toString() ?? '0',
      cacheQuery
    );
    return this.performanceCacheService.wrap(
      cacheKey,
      () => {
        return this.recordService.getDocIdsByQuery(tableId, cacheQuery, true);
      },
      {
        ttl: 60 * 60, // 1 hour
      }
    );
  }

  @Permissions('table|read')
  @Get(':recordId/status')
  async getRecordStatus(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Query(new ZodValidationPipe(getRecordsRoSchema), TqlPipe) query: IGetRecordsRo
  ): Promise<IRecordStatusVo> {
    return await this.recordService.getRecordStatus(tableId, recordId, query);
  }

  @Permissions('record|update')
  @Post(':recordId/:fieldId/auto-fill')
  async autoFillCell(
    @Param('tableId') _tableId: string,
    @Param('recordId') _recordId: string,
    @Param('fieldId') _fieldId: string
  ): Promise<IAutoFillCellVo> {
    return { taskId: '' };
  }

  @Permissions('record|read')
  @Post(':recordId/:fieldId/button-click')
  async buttonClick(
    @Req() req: Express.Request,
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Param('fieldId') fieldId: string
  ): Promise<IButtonClickVo> {
    const result = await this.recordOpenApiService.buttonClick(tableId, recordId, fieldId);
    return { ...result, runId: '' };
  }

  @Permissions('record|update')
  @Post(':recordId/:fieldId/button-reset')
  async buttonReset(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Param('fieldId') fieldId: string
  ): Promise<IRecord> {
    return await this.recordOpenApiService.resetButton(tableId, recordId, fieldId);
  }
}
