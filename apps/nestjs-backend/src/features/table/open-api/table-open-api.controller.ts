import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiResponse, ApiOperation, ApiTags, ApiOkResponse } from '@nestjs/swagger';
import { responseWrap } from 'src/utils/api-response';
import { CreateTableRo } from '../create-table.ro';
import { FullSSRSnapshotVo, TableSSRDefaultViewIdVo, TableSSRSnapshotVo } from '../ssr-snapshot.vo';
import { TableService } from '../table.service';
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
    return responseWrap(snapshot);
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
    return responseWrap(snapshot);
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
  @ApiResponse({ status: 201, description: 'The Table has been successfully created.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @Post()
  createTable(@Body(TablePipe) createTable: CreateTableRo) {
    return this.tableOpenApiService.createTable(createTable);
  }

  @Delete('/arbitrary/:tableId')
  deleteTableArbitrary(@Param('tableId') tableId: string) {
    return this.tableService.deleteTableArbitrary(tableId);
  }
}
