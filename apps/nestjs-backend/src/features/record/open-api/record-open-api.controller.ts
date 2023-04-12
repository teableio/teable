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
import type { ApiResponse } from 'src/utils/api-response';
import { responseWrap } from 'src/utils/api-response';
import { CreateRecordsRo } from '../create-records.ro';
import { RecordService } from '../record.service';
import { UpdateRecordRoByIndexRo } from '../update-record-by-index.ro';
import { UpdateRecordRo } from '../update-record.ro';
import { RecordOpenApiService } from './record-open-api.service';
import { RecordsVo } from './record.vo';
import { RecordsRo } from './records.ro';

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
    type: RecordsVo,
  })
  @Get()
  async getRecords(
    @Param('tableId') tableId: string,
    @Query() query: RecordsRo
  ): Promise<ApiResponse<RecordsVo>> {
    const records = await this.recordService.getRecords(tableId, query);
    return responseWrap(records);
  }

  @ApiOperation({ summary: 'Update records by id' })
  @ApiOkResponse({ description: 'The record has been successfully updated.' })
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
    @Body() updateRecordRo: UpdateRecordRo
  ) {
    await this.recordOpenApiService.updateRecordById(tableId, recordId, updateRecordRo);
    return responseWrap(null);
  }

  @ApiOperation({ summary: 'Update records by row index' })
  @ApiOkResponse({ description: 'The record has been successfully updated.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  @ApiParam({
    name: 'tableId',
    description: 'The id for table.',
    example: 'tbla63d4543eb5eded6',
  })
  @Put()
  async updateRecordByIndex(
    @Param('tableId') tableId: string,
    @Body() updateRecordRoByIndexRo: UpdateRecordRoByIndexRo
  ) {
    await this.recordOpenApiService.updateRecordByIndex(tableId, updateRecordRoByIndexRo);
    return responseWrap(null);
  }

  @ApiOperation({ summary: 'Create records' })
  @ApiCreatedResponse({ description: 'The record has been successfully created.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  @ApiParam({
    name: 'tableId',
    description: 'The id for table.',
    example: 'tbla63d4543eb5eded6',
  })
  @Post()
  async createRecords(
    @Param('tableId') tableId: string,
    @Body() createRecordsDto: CreateRecordsRo
  ) {
    await this.recordOpenApiService.multipleCreateRecords(tableId, createRecordsDto);
    return responseWrap(null);
  }
}
