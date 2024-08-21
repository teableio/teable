/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { ICreateRecordsVo, IRecord, IRecordsVo } from '@teable/openapi';
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
} from '@teable/openapi';
import { EmitControllerEvent } from '../../../event-emitter/decorators/emit-controller-event.decorator';
import { Events } from '../../../event-emitter/events';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { RecordService } from '../record.service';
import { RecordOpenApiService } from './record-open-api.service';
import { TqlPipe } from './tql.pipe';

@Controller('api/table/:tableId/record')
export class RecordOpenApiController {
  constructor(
    private readonly recordService: RecordService,
    private readonly recordOpenApiService: RecordOpenApiService
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
    @Query(new ZodValidationPipe(getRecordsRoSchema), TqlPipe) query: IGetRecordsRo
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
    @Body(new ZodValidationPipe(updateRecordRoSchema)) updateRecordRo: IUpdateRecordRo
  ): Promise<IRecord> {
    return await this.recordOpenApiService.updateRecord(tableId, recordId, updateRecordRo);
  }

  @Permissions('record|update')
  @Patch()
  async updateRecords(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(updateRecordsRoSchema)) updateRecordsRo: IUpdateRecordsRo
  ): Promise<IRecord[]> {
    return await this.recordOpenApiService.updateRecords(tableId, updateRecordsRo);
  }

  @Permissions('record|create')
  @Post()
  @EmitControllerEvent(Events.CONTROLLER_RECORDS_CREATE)
  async createRecords(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(createRecordsRoSchema)) createRecordsRo: ICreateRecordsRo
  ): Promise<ICreateRecordsVo> {
    return await this.recordOpenApiService.multipleCreateRecords(tableId, createRecordsRo);
  }

  @Permissions('record|delete')
  @Delete(':recordId')
  @EmitControllerEvent(Events.CONTROLLER_RECORD_DELETE)
  async deleteRecord(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string
  ): Promise<IRecord> {
    return await this.recordOpenApiService.deleteRecord(tableId, recordId);
  }

  @Permissions('record|delete')
  @Delete()
  async deleteRecords(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(deleteRecordsQuerySchema)) query: IDeleteRecordsQuery
  ): Promise<IRecordsVo> {
    return await this.recordOpenApiService.deleteRecords(tableId, query.recordIds);
  }

  @Permissions('record|read')
  @Get('/socket/snapshot-bulk')
  async getSnapshotBulk(
    @Param('tableId') tableId: string,
    @Query('ids') ids: string[],
    @Query('projection') projection?: { [fieldNameOrId: string]: boolean }
  ) {
    return this.recordService.getSnapshotBulk(tableId, ids, projection);
  }

  @Permissions('record|read')
  @Get('/socket/doc-ids')
  async getDocIds(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getRecordsRoSchema), TqlPipe) query: IGetRecordsRo
  ) {
    return this.recordService.getDocIdsByQuery(tableId, query);
  }
}
