import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiParam, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateRecordsDto } from '../create-records.dto';
import { RecordService } from '../record.service';
import { RecordOpenApiService } from './record-open-api.service';

@ApiBearerAuth()
@ApiTags('record')
@Controller('api/table/:tableId/record')
export class RecordOpenApiController {
  constructor(
    private readonly recordService: RecordService,
    private readonly recordCommandService: RecordOpenApiService
  ) {}

  @Get(':recordId')
  getRecord(@Param('tableId') tableId: string, @Param('recordId') recordId: string) {
    return this.recordService.getRecord(tableId, recordId);
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
    return this.recordCommandService.multipleCreateRecords(tableId, createRecordsDto);
  }
}
