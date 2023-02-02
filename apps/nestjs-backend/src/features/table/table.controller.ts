import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateTableDto } from './create-table.dto';
import { TableService } from './table.service';

@ApiBearerAuth()
@ApiTags('table')
@Controller('api/table')
export class TableController {
  constructor(private readonly tableService: TableService) {}

  @Get(':tableId')
  getTable(@Param('tableId') tableId: string) {
    return this.tableService.getTable(tableId);
  }

  @ApiOperation({ summary: 'Create table' })
  @ApiResponse({ status: 201, description: 'The Table has been successfully created.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @Post()
  createTable(@Body() createTable: CreateTableDto) {
    return this.tableService.createTable(createTable);
  }

  @Delete('/arbitrary/:tableId')
  deleteTableArbitrary(@Param('tableId') tableId: string) {
    return this.tableService.deleteTableArbitrary(tableId);
  }
}
