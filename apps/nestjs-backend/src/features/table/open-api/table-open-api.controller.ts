import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  ApiOperation,
  ApiTags,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import type { ApiResponse } from '../../../utils/api-response';
import { responseWrap } from '../../../utils/api-response';
import { CreateTableRo } from '../create-table.ro';
import { FullSSRSnapshotVo, TableSSRDefaultViewIdVo, TableSSRSnapshotVo } from '../ssr-snapshot.vo';
import { TableService } from '../table.service';
import { TableVo } from '../table.vo';
import { TableOpenApiService } from './table-open-api.service';
import { TablePipe } from './table.pipe';

@ApiTags('table')
@Controller('api/table')
export class TableController {
  constructor(
    private readonly tableService: TableService,
    private readonly tableOpenApiService: TableOpenApiService
  ) {}

  @Get('/ssr/:tableId/view-id')
  @ApiOkResponse({
    description: 'default id in table',
    type: TableSSRDefaultViewIdVo,
  })
  async getDefaultViewId(@Param('tableId') tableId: string): Promise<TableSSRDefaultViewIdVo> {
    const snapshot = await this.tableService.getDefaultViewId(tableId);
    return responseWrap(snapshot!);
  }

  @Get('/ssr/:tableId/:viewId')
  @ApiOkResponse({
    description: 'ssr snapshot',
    type: FullSSRSnapshotVo,
  })
  async getFullSSRSnapshot(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<FullSSRSnapshotVo> {
    const snapshot = await this.tableService.getSSRSnapshot(tableId, viewId);
    return responseWrap(snapshot!);
  }

  @Get('/ssr')
  @ApiOkResponse({
    description: 'ssr snapshot',
    type: TableSSRSnapshotVo,
  })
  async getTableSSRSnapshot(): Promise<TableSSRSnapshotVo> {
    const snapshot = await this.tableService.getTableSSRSnapshot();
    return responseWrap(snapshot);
  }

  @ApiOperation({ summary: 'Create table' })
  @ApiCreatedResponse({
    status: 201,
    description: 'The table has been successfully created.',
    type: TableVo,
  })
  @ApiForbiddenResponse({ status: 403, description: 'Forbidden.' })
  @Post()
  async createTable(@Body(TablePipe) createTable: CreateTableRo): Promise<ApiResponse<TableVo>> {
    const result = await this.tableOpenApiService.createTable(createTable);
    return responseWrap(result);
  }

  @ApiOperation({ summary: 'Delete table' })
  @ApiOkResponse({ description: 'The table has been removed to trash.' })
  @ApiForbiddenResponse({ status: 403, description: 'Forbidden.' })
  @Delete('/:tableId')
  async archiveTable(@Param('tableId') tableId: string) {
    const result = await this.tableOpenApiService.archiveTable(tableId);
    return responseWrap(result);
  }

  @Delete('/arbitrary/:tableId')
  deleteTableArbitrary(@Param('tableId') tableId: string) {
    return this.tableService.deleteTableArbitrary(tableId);
  }
}
