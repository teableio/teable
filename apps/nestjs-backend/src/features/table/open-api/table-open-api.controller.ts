/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import type { ITableFullVo, ITableListVo, ITableVo } from '@teable/openapi';
import {
  tableRoSchema,
  ICreateTableWithDefault,
  dbTableNameRoSchema,
  IDbTableNameRo,
  ISqlQuerySchema,
  ITableDescriptionRo,
  ITableIconRo,
  ITableNameRo,
  IUpdateOrderRo,
  sqlQuerySchema,
  tableDescriptionRoSchema,
  tableIconRoSchema,
  tableNameRoSchema,
  updateOrderRoSchema,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { TablePermissionService } from '../table-permission.service';
import { TableService } from '../table.service';
import { TableOpenApiService } from './table-open-api.service';
import { TablePipe } from './table.pipe';

@Controller('api/base/:baseId/table')
export class TableController {
  constructor(
    private readonly tableService: TableService,
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly tablePermissionService: TablePermissionService
  ) {}

  @Permissions('table|read')
  @Get(':tableId/default-view-id')
  async getDefaultViewId(@Param('tableId') tableId: string): Promise<{ id: string }> {
    return await this.tableService.getDefaultViewId(tableId);
  }

  @Permissions('table|read')
  @Get(':tableId')
  async getTable(
    @Param('baseId') baseId: string,
    @Param('tableId') tableId: string
  ): Promise<ITableVo> {
    return await this.tableOpenApiService.getTable(baseId, tableId);
  }

  @Permissions('table|read')
  @Get()
  async getTables(@Param('baseId') baseId: string): Promise<ITableListVo> {
    return await this.tableOpenApiService.getTables(baseId);
  }

  @Permissions('table|update')
  @Put(':tableId/name')
  async updateName(
    @Param('baseId') baseId: string,
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(tableNameRoSchema)) tableNameRo: ITableNameRo
  ) {
    return await this.tableOpenApiService.updateName(baseId, tableId, tableNameRo.name);
  }

  @Permissions('table|update')
  @Put(':tableId/icon')
  async updateIcon(
    @Param('baseId') baseId: string,
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(tableIconRoSchema)) tableIconRo: ITableIconRo
  ) {
    return await this.tableOpenApiService.updateIcon(baseId, tableId, tableIconRo.icon);
  }

  @Permissions('table|update')
  @Put(':tableId/description')
  async updateDescription(
    @Param('baseId') baseId: string,
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(tableDescriptionRoSchema)) tableDescriptionRo: ITableDescriptionRo
  ) {
    return await this.tableOpenApiService.updateDescription(
      baseId,
      tableId,
      tableDescriptionRo.description
    );
  }

  @Permissions('table|update')
  @Put(':tableId/db-table-name')
  async updateDbTableName(
    @Param('baseId') baseId: string,
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(dbTableNameRoSchema)) dbTableNameRo: IDbTableNameRo
  ) {
    return await this.tableOpenApiService.updateDbTableName(
      baseId,
      tableId,
      dbTableNameRo.dbTableName
    );
  }

  @Permissions('table|update')
  @Put(':tableId/order')
  async updateOrder(
    @Param('baseId') baseId: string,
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(updateOrderRoSchema)) updateOrderRo: IUpdateOrderRo
  ) {
    return await this.tableOpenApiService.updateOrder(baseId, tableId, updateOrderRo);
  }

  @Post()
  @Permissions('table|create')
  async createTable(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(tableRoSchema), TablePipe) createTableRo: ICreateTableWithDefault
  ): Promise<ITableFullVo> {
    return await this.tableOpenApiService.createTable(baseId, createTableRo);
  }

  @Delete(':tableId')
  @Permissions('table|delete')
  async archiveTable(@Param('baseId') baseId: string, @Param('tableId') tableId: string) {
    return await this.tableOpenApiService.deleteTable(baseId, tableId);
  }

  @Delete(':tableId/permanent')
  @Permissions('table|delete')
  permanentDeleteTable(@Param('baseId') baseId: string, @Param('tableId') tableId: string) {
    return this.tableOpenApiService.permanentDeleteTables(baseId, [tableId]);
  }

  @Permissions('table|read')
  @Post(':tableId/sql-query')
  async sqlQuery(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(sqlQuerySchema)) query: ISqlQuerySchema
  ) {
    return await this.tableOpenApiService.sqlQuery(tableId, query.viewId, query.sql);
  }

  @Permissions('table|read')
  @Get(':tableId/permission')
  async getPermission(@Param('baseId') baseId: string, @Param('tableId') tableId: string) {
    return await this.tableOpenApiService.getPermission(baseId, tableId);
  }

  @Permissions('table|read')
  @Get('/socket/snapshot-bulk')
  async getSnapshotBulk(@Param('baseId') baseId: string, @Query('ids') ids: string[]) {
    const permissionMap = await this.tablePermissionService.getTablePermissionMapByBaseId(
      baseId,
      ids
    );
    const snapshotBulk = await this.tableService.getSnapshotBulk(baseId, ids);
    return snapshotBulk.map((snapshot) => {
      return {
        ...snapshot,
        data: {
          ...snapshot.data,
          permission: permissionMap[snapshot.id],
        },
      };
    });
  }

  @Permissions('table|read')
  @Get('/socket/doc-ids')
  async getDocIds(@Param('baseId') baseId: string) {
    return this.tableService.getDocIdsByQuery(baseId, undefined);
  }
}
