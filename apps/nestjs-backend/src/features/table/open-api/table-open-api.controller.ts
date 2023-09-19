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

@Controller('api/base/:baseId/table')
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
    @Param('baseId') baseId: string,
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getTableQuerySchema)) query: IGetTableQuery
  ): Promise<ITableVo> {
    return await this.tableService.getTable(baseId, tableId, query);
  }

  @Get()
  async getTables(@Param('baseId') baseId: string): Promise<ITableListVo> {
    return await this.tableService.getTables(baseId);
  }

  @Post()
  async createTable(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(tableRoSchema), TablePipe) createTableRo: ICreateTablePreparedRo
  ): Promise<ITableFullVo> {
    return await this.tableOpenApiService.createTable(baseId, createTableRo);
  }

  @Delete(':tableId')
  async archiveTable(@Param('baseId') baseId: string, @Param('tableId') tableId: string) {
    return await this.tableOpenApiService.deleteTable(baseId, tableId);
  }

  @Delete('arbitrary/:tableId')
  deleteTableArbitrary(@Param('baseId') baseId: string, @Param('tableId') tableId: string) {
    return this.tableOpenApiService.deleteTable(baseId, tableId);
  }

  @Post(':tableId/graph')
  async getCellGraph(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(getGraphRoSchema)) { cell, viewId }: IGetGraphRo
  ) {
    return await this.graphService.getGraph(tableId, cell, viewId);
  }
}
