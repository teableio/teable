import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiOperation, ApiTags, ApiOkResponse } from '@nestjs/swagger';
import { responseWrap } from 'src/utils/api-response';
import { CreateTableRo } from '../create-table.ro';
import { SSRSnapshotVo } from '../ssr-snapshot.vo';
import { TableService } from '../table.service';

@ApiBearerAuth()
@ApiTags('table')
@Controller('api/table')
export class TableController {
  constructor(private readonly tableService: TableService) {}
  @Get('/:tableId/ssr')
  @ApiOkResponse({
    description: 'ssr snapshot',
    type: SSRSnapshotVo,
  })
  async getSSRSnapshot(@Param('tableId') tableId: string): Promise<SSRSnapshotVo> {
    const snapshot = await this.tableService.getSSRSnapshot(tableId);
    return responseWrap(snapshot);
  }

  @ApiOperation({ summary: 'Create table' })
  @ApiResponse({ status: 201, description: 'The Table has been successfully created.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @Post()
  createTable(@Body() createTable: CreateTableRo) {
    return this.tableService.createTable(createTable);
  }

  @Delete('/arbitrary/:tableId')
  deleteTableArbitrary(@Param('tableId') tableId: string) {
    return this.tableService.deleteTableArbitrary(tableId);
  }
}
