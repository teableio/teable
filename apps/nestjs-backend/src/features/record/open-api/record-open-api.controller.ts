import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiTags,
  ApiOkResponse,
} from '@nestjs/swagger';
import { CreateRecordsDto } from '../create-records.dto';
import { RecordService } from '../record.service';
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
  getRecords(@Param('tableId') tableId: string, @Query() query: RecordsRo): Promise<RecordsVo> {
    return this.recordService.getRecords(tableId, query);
  }

  @ApiOperation({ summary: 'Create records' })
  @ApiResponse({ status: 201, description: 'The record has been successfully created.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiParam({
    name: 'tableId',
    description: 'The id for table.',
    example: 'tbla63d4543eb5eded6',
  })
  @Post()
  createRecords(@Param('tableId') tableId: string, @Body() createRecordsDto: CreateRecordsDto) {
    return this.recordOpenApiService.multipleCreateRecords(tableId, createRecordsDto);
  }
}
