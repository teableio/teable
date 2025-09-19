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
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IAutoFillCellVo,
  IButtonClickVo,
  ICreateRecordsVo,
  IRecord,
  IRecordStatusVo,
  IRecordsVo,
} from '@teable/openapi';
import {
  createRecordsRoSchema,
  getRecordQuerySchema,
  getRecordsRoSchema,
  IGetRecordsRo,
  ICreateRecordsRo,
  IGetRecordQuery,
  IUpdateRecordRo,
  updateRecordRoSchema,
  deleteRecordsQuerySchema,
  IDeleteRecordsQuery,
  getRecordHistoryQuerySchema,
  IGetRecordHistoryQuery,
  updateRecordsRoSchema,
  IUpdateRecordsRo,
  recordInsertOrderRoSchema,
  IRecordInsertOrderRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { EmitControllerEvent } from '../../../event-emitter/decorators/emit-controller-event.decorator';
import { Events } from '../../../event-emitter/events';
import { PerformanceCacheService } from '../../../performance-cache';
import { generateRecordCacheKey } from '../../../performance-cache/generate-keys';
import type { IClsStore } from '../../../types/cls';
import { filterHasMe } from '../../../utils/filter-has-me';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { RecordService } from '../record.service';
import { FieldKeyPipe } from './field-key.pipe';
import { RecordOpenApiService } from './record-open-api.service';
import { TqlPipe } from './tql.pipe';

@Controller('api/table/:tableId/record')
export class RecordOpenApiController {
  constructor(
    private readonly recordService: RecordService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly performanceCacheService: PerformanceCacheService,
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
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
  @Get()
  async getRecords(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getRecordsRoSchema), TqlPipe, FieldKeyPipe) query: IGetRecordsRo
  ): Promise<IRecordsVo> {
    return await this.recordService.getRecords(tableId, query);
  }

  @Permissions('record|read')
  @Get(':recordId')
  async getRecord(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Query(new ZodValidationPipe(getRecordQuerySchema)) query: IGetRecordQuery
  ): Promise<IRecord> {
    return await this.recordService.getRecord(tableId, recordId, query);
  }

  @Permissions('record|update')
  @Patch(':recordId')
  async updateRecord(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Body(new ZodValidationPipe(updateRecordRoSchema)) updateRecordRo: IUpdateRecordRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<IRecord> {
    return await this.recordOpenApiService.updateRecord(
      tableId,
      recordId,
      updateRecordRo,
      windowId
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
  @Patch()
  async updateRecords(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(updateRecordsRoSchema)) updateRecordsRo: IUpdateRecordsRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<IRecord[]> {
    return (await this.recordOpenApiService.updateRecords(tableId, updateRecordsRo, windowId))
      .records;
  }

  @Permissions('record|create')
  @Post()
  @EmitControllerEvent(Events.OPERATION_RECORDS_CREATE)
  async createRecords(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(createRecordsRoSchema)) createRecordsRo: ICreateRecordsRo
  ): Promise<ICreateRecordsVo> {
    return await this.recordOpenApiService.multipleCreateRecords(tableId, createRecordsRo);
  }

  @Permissions('record|create', 'record|read')
  @Post(':recordId/duplicate')
  @EmitControllerEvent(Events.OPERATION_RECORDS_CREATE)
  async duplicateRecord(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Body(new ZodValidationPipe(recordInsertOrderRoSchema)) order: IRecordInsertOrderRo
  ) {
    return await this.recordOpenApiService.duplicateRecord(tableId, recordId, order);
  }

  @Permissions('record|delete')
  @Delete(':recordId')
  async deleteRecord(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Headers('x-window-id') windowId?: string
  ): Promise<IRecord> {
    return await this.recordOpenApiService.deleteRecord(tableId, recordId, windowId);
  }

  @Permissions('record|delete')
  @Delete()
  async deleteRecords(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(deleteRecordsQuerySchema)) query: IDeleteRecordsQuery,
    @Headers('x-window-id') windowId?: string
  ): Promise<IRecordsVo> {
    return await this.recordOpenApiService.deleteRecords(tableId, query.recordIds, windowId);
  }

  @Permissions('record|read')
  @Get('/socket/snapshot-bulk')
  async getSnapshotBulk(
    @Param('tableId') tableId: string,
    @Query('ids') ids: string[],
    @Query('projection') projection?: { [fieldNameOrId: string]: boolean }
  ) {
    return this.recordService.getSnapshotBulkWithPermission(tableId, ids, projection);
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
        return this.recordService.getDocIdsByQuery(tableId, cacheQuery);
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
