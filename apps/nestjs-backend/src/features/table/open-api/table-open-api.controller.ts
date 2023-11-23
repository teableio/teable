/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { ITableFullVo, ITableListVo, ITableVo, IViewRowCountVo } from '@teable-group/core';
import {
  getGraphRoSchema,
  IGetGraphRo,
  getTableQuerySchema,
  IGetTableQuery,
  tableRoSchema,
  getRowCountSchema,
  IGetRowCountRo,
  ICreateTableRo,
} from '@teable-group/core';
import { ISqlQuerySchema, sqlQuerySchema } from '@teable-group/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../../auth/guard/permission.guard';
import { TableService } from '../table.service';
import { GraphService } from './graph.service';
import { TableOpenApiService } from './table-open-api.service';
import { TablePipe } from './table.pipe';

@Controller('api/base/:baseId/table')
@UseGuards(PermissionGuard)
export class TableController {
  constructor(
    private readonly tableService: TableService,
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly graphService: GraphService
  ) {}

  @Permissions('table|read')
  @Get(':tableId/rowCount')
  async getRowCount(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getRowCountSchema)) query: IGetRowCountRo
  ): Promise<IViewRowCountVo> {
    return await this.tableOpenApiService.getRowCount(tableId, query);
  }

  @Permissions('table|read')
  @Get(':tableId/defaultViewId')
  async getDefaultViewId(@Param('tableId') tableId: string): Promise<{ id: string }> {
    return await this.tableService.getDefaultViewId(tableId);
  }

  @Permissions('table|read')
  @Get(':tableId')
  async getTable(
    @Param('baseId') baseId: string,
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getTableQuerySchema)) query: IGetTableQuery
  ): Promise<ITableVo> {
    return await this.tableOpenApiService.getTable(baseId, tableId, query);
  }

  @Permissions('table|read')
  @Get()
  async getTables(@Param('baseId') baseId: string): Promise<ITableListVo> {
    return await this.tableOpenApiService.getTables(baseId);
  }

  @Permissions('table|create')
  @Post()
  async createTable(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(tableRoSchema), TablePipe) createTableRo: ICreateTableRo
  ): Promise<ITableFullVo> {
    return await this.tableOpenApiService.createTable(baseId, createTableRo);
  }

  @Permissions('table|delete')
  @Delete(':tableId')
  async archiveTable(@Param('baseId') baseId: string, @Param('tableId') tableId: string) {
    return await this.tableOpenApiService.deleteTable(baseId, tableId);
  }

  @Permissions('table|delete')
  @Delete('arbitrary/:tableId')
  deleteTableArbitrary(@Param('baseId') baseId: string, @Param('tableId') tableId: string) {
    return this.tableOpenApiService.deleteTable(baseId, tableId);
  }

  @Permissions('table|read')
  @Post(':tableId/graph')
  async getCellGraph(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(getGraphRoSchema)) { cell, viewId }: IGetGraphRo
  ) {
    return await this.graphService.getGraph(tableId, cell, viewId);
  }

  @Permissions('table|read')
  @Post(':tableId/sqlQuery')
  async sqlQuery(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(sqlQuerySchema)) query: ISqlQuerySchema
  ) {
    return await this.tableOpenApiService.sqlQuery(tableId, query.viewId, query.sql);
  }
}
