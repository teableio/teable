/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import type { IViewVo } from '@teable-group/core';
import {
  viewRoSchema,
  manualSortRoSchema,
  IManualSortRo,
  IViewRo,
  IColumnMetaRo,
  columnMetaRoSchema,
  IFilter,
  filterSchema,
  ISort,
  sortSchema,
  viewOptionRoSchema,
  IViewOptionRo,
  groupSchema,
  IGroup,
} from '@teable-group/core';
import type { EnableShareViewVo } from '@teable-group/openapi';
import { ZodValidationPipe } from '../../..//zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../../auth/guard/permission.guard';
import { ViewService } from '../view.service';
import { ViewOpenApiService } from './view-open-api.service';

@Controller('api/table/:tableId/view')
@UseGuards(PermissionGuard)
export class ViewOpenApiController {
  constructor(
    private readonly viewService: ViewService,
    private readonly viewOpenApiService: ViewOpenApiService
  ) {}

  @Permissions('view|read')
  @Get(':viewId')
  async getView(
    @Param('tableId') _tableId: string,
    @Param('viewId') viewId: string
  ): Promise<IViewVo> {
    return await this.viewService.getViewById(viewId);
  }

  @Permissions('view|read')
  @Get()
  async getViews(@Param('tableId') tableId: string): Promise<IViewVo[]> {
    return await this.viewService.getViews(tableId);
  }

  @Permissions('view|create')
  @Post()
  async createView(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(viewRoSchema)) viewRo: IViewRo
  ): Promise<IViewVo> {
    return await this.viewOpenApiService.createView(tableId, viewRo);
  }

  @Permissions('view|delete')
  @Delete('/:viewId')
  async deleteView(@Param('tableId') tableId: string, @Param('viewId') viewId: string) {
    return await this.viewOpenApiService.deleteView(tableId, viewId);
  }

  @Permissions('view|update')
  @Put('/:viewId/sort')
  async manualSort(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(manualSortRoSchema))
    updateViewOrderRo: IManualSortRo
  ): Promise<void> {
    return await this.viewOpenApiService.manualSort(tableId, viewId, updateViewOrderRo);
  }

  @Permissions('view|update')
  @Put('/:viewId/columnMeta')
  async updateFieldsVisible(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(columnMetaRoSchema))
    updateViewColumnMetaRo: IColumnMetaRo
  ): Promise<void> {
    return await this.viewOpenApiService.setViewColumnMeta(tableId, viewId, updateViewColumnMetaRo);
  }

  @Permissions('view|update')
  @Put('/:viewId/filter')
  async updateViewFilter(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(filterSchema))
    updateViewFilterRo: IFilter
  ): Promise<void> {
    return await this.viewOpenApiService.setViewFilter(tableId, viewId, updateViewFilterRo);
  }

  @Permissions('view|update')
  @Put('/:viewId/viewSort')
  async updateViewSort(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(sortSchema))
    updateViewSortRo: ISort
  ): Promise<void> {
    return await this.viewOpenApiService.setViewSort(tableId, viewId, updateViewSortRo);
  }

  @Permissions('view|update')
  @Put('/:viewId/viewGroup')
  async updateViewGroup(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(groupSchema))
    updateViewGroupRo: IGroup
  ): Promise<void> {
    return await this.viewOpenApiService.setViewGroup(tableId, viewId, updateViewGroupRo);
  }

  @Permissions('view|update')
  @Put('/:viewId/option')
  async updateViewOption(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewOptionRoSchema))
    updateViewOptionRo: IViewOptionRo
  ): Promise<void> {
    return await this.viewOpenApiService.setViewOption(tableId, viewId, updateViewOptionRo);
  }

  @Permissions('view|update')
  @Patch('/:viewId/enableShare')
  async enableShare(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<EnableShareViewVo> {
    return await this.viewOpenApiService.enableShare(tableId, viewId);
  }

  @Permissions('view|update')
  @Patch('/:viewId/disableShare')
  async disableShare(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<void> {
    return await this.viewOpenApiService.disableShare(tableId, viewId);
  }
}
