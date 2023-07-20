/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiBearerAuth,
  ApiTags,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import type { ICreateRecordsVo, IRecord, IRecordsVo } from '@teable-group/core';
import {
  createRecordsRoSchema,
  getRecordQuerySchema,
  updateRecordByIndexRoSchema,
  updateRecordRoSchema,
  getRecordsQuerySchema,
  IGetRecordsQuery,
  IGetRecordQuery,
  ICreateRecordsRo,
  IUpdateRecordByIndexRo,
  IUpdateRecordRo,
} from '@teable-group/core';
import { ApiResponse, responseWrap } from '../../../utils/api-response';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { RecordService } from '../record.service';
import { RecordOpenApiService } from './record-open-api.service';

@ApiBearerAuth()
@ApiTags('record')
@Controller('api/table/:tableId/record')
export class RecordOpenApiController {
  constructor(
    private readonly recordService: RecordService,
    private readonly recordOpenApiService: RecordOpenApiService
  ) {}

  @ApiOkResponse({
    description: 'list of records',
    type: ApiResponse<IRecordsVo>,
  })
  @Get()
  async getRecords(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getRecordsQuerySchema)) query: IGetRecordsQuery
  ): Promise<ApiResponse<IRecordsVo>> {
    const records = await this.recordService.getRecords(tableId, query);
    return responseWrap(records);
  }

  @ApiOkResponse({
    description: 'Get record by id.',
    type: ApiResponse<IRecordsVo>,
  })
  @Get(':recordId')
  async getRecord(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Query(new ZodValidationPipe(getRecordQuerySchema)) query: IGetRecordQuery
  ): Promise<ApiResponse<IRecord>> {
    const record = await this.recordService.getRecord(
      tableId,
      recordId,
      query.projection,
      query.fieldKeyType
    );
    return responseWrap(record);
  }

  @ApiOperation({ summary: 'Update records by id.' })
  @ApiOkResponse({
    description: 'The record has been successfully updated.',
    type: ApiResponse<IRecord>,
  })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  @ApiParam({
    name: 'tableId',
    description: 'The id for table.',
    example: 'tbla63d4543eb5eded6',
  })
  @Put(':recordId')
  async updateRecordById(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Body(new ZodValidationPipe(updateRecordRoSchema)) updateRecordRo: IUpdateRecordRo
  ): Promise<ApiResponse<IRecord>> {
    const record = await this.recordOpenApiService.updateRecordById(
      tableId,
      recordId,
      updateRecordRo
    );
    return responseWrap(record);
  }

  @ApiOperation({ summary: 'Update records by row index' })
  @ApiOkResponse({
    description: 'The record has been successfully updated.',
    type: ApiResponse<IRecord>,
  })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  @ApiParam({
    name: 'tableId',
    description: 'The id for table.',
    example: 'tbla63d4543eb5eded6',
  })
  @Put()
  async updateRecordByIndex(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(updateRecordByIndexRoSchema))
    updateRecordRoByIndexRo: IUpdateRecordByIndexRo
  ): Promise<ApiResponse<IRecord>> {
    const record = await this.recordOpenApiService.updateRecordByIndex(
      tableId,
      updateRecordRoByIndexRo
    );
    return responseWrap(record);
  }

  @ApiOperation({ summary: 'Create records' })
  @ApiCreatedResponse({
    description: 'The record has been successfully created.',
    type: ApiResponse<IRecordsVo>,
  })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  @ApiParam({
    name: 'tableId',
    description: 'The id for table.',
    example: 'tbla63d4543eb5eded6',
  })
  @Post()
  async createRecords(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(createRecordsRoSchema)) createRecordsRo: ICreateRecordsRo
  ): Promise<ApiResponse<ICreateRecordsVo>> {
    const records = await this.recordOpenApiService.multipleCreateRecords(tableId, createRecordsRo);
    return responseWrap(records);
  }
}
