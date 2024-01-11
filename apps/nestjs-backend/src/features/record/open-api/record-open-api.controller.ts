import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ICreateRecordsVo, IRecord, IRecordsVo } from '@teable-group/core';
import {
  createRecordsRoSchema,
  getRecordQuerySchema,
  getRecordsRoSchema,
  IGetRecordsRo,
  ICreateRecordsRo,
  IGetRecordQuery,
  IUpdateRecordRo,
  updateRecordRoSchema,
} from '@teable-group/core';
import { deleteRecordsQuerySchema, IDeleteRecordsQuery } from '@teable-group/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../../auth/guard/permission.guard';
import { RecordService } from '../record.service';
import { RecordOpenApiService } from './record-open-api.service';
import { TqlPipe } from './tql.pipe';

@Controller('api/table/:tableId/record')
@UseGuards(PermissionGuard)
export class RecordOpenApiController {
  constructor(
    private readonly recordService: RecordService,
    private readonly recordOpenApiService: RecordOpenApiService
  ) {}

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
  async updateRecordById(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Body(new ZodValidationPipe(updateRecordRoSchema)) updateRecordRo: IUpdateRecordRo
  ): Promise<IRecord> {
    return await this.recordOpenApiService.updateRecordById(tableId, recordId, updateRecordRo);
  }

  @Permissions('record|create')
  @Post()
  async createRecords(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(createRecordsRoSchema)) createRecordsRo: ICreateRecordsRo
  ): Promise<ICreateRecordsVo> {
    return await this.recordOpenApiService.multipleCreateRecords(tableId, createRecordsRo);
  }

  @Permissions('record|delete')
  @Delete(':recordId')
  async deleteRecord(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string
  ): Promise<void> {
    return await this.recordOpenApiService.deleteRecord(tableId, recordId);
  }

  @Permissions('record|delete')
  @Delete()
  async deleteRecords(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(deleteRecordsQuerySchema)) query: IDeleteRecordsQuery
  ): Promise<void> {
    return await this.recordOpenApiService.deleteRecords(tableId, query.recordIds);
  }
}
