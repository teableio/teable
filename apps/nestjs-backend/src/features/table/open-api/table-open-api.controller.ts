import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type { ITableFullVo, ITableListVo, ITableVo } from '@teable-group/core';
import {
  getGraphRoSchema,
  IGetGraphRo,
  getTableQuerySchema,
  ICreateTablePreparedRo,
  IGetTableQuery,
  tableRoSchema,
} from '@teable-group/core';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { TableService } from '../table.service';
import { GraphService } from './graph.service';
import { TableOpenApiService } from './table-open-api.service';
import { TablePipe } from './table.pipe';

@Controller('api/table')
export class TableController {
  constructor(
    private readonly tableService: TableService,
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly graphService: GraphService
  ) {}

  @Get(':tableId/defaultViewId')
  async getDefaultViewId(@Param('tableId') tableId: string): Promise<{ id: string }> {
    return await this.tableService.getDefaultViewId(tableId);
  }

  @Get(':tableId')
  async getTable(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getTableQuerySchema)) query: IGetTableQuery
  ): Promise<ITableVo> {
    return await this.tableService.getTable(tableId, query);
  }

  @Get()
  async getTables(): Promise<ITableListVo> {
    return await this.tableService.getTables();
  }

  @Post()
  async createTable(
    @Body(new ZodValidationPipe(tableRoSchema), TablePipe) createTableRo: ICreateTablePreparedRo
  ): Promise<ITableFullVo> {
    return await this.tableOpenApiService.createTable(createTableRo);
  }

  @Delete(':tableId')
  async archiveTable(@Param('tableId') tableId: string) {
    return await this.tableOpenApiService.deleteTable(tableId);
  }

  @Delete('arbitrary/:tableId')
  deleteTableArbitrary(@Param('tableId') tableId: string) {
    return this.tableOpenApiService.deleteTable(tableId);
  }

  @Post(':tableId/graph')
  async getCellGraph(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(getGraphRoSchema)) { cell, viewId }: IGetGraphRo
  ) {
    return await this.graphService.getGraph(tableId, cell, viewId);
  }
}
