/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import type { IViewVo } from '@teable/core';
import {
  viewRoSchema,
  manualSortRoSchema,
  IManualSortRo,
  IViewRo,
  IColumnMetaRo,
  columnMetaRoSchema,
  IFilterRo,
  IViewGroupRo,
  filterRoSchema,
  viewGroupRoSchema,
} from '@teable/core';
import {
  viewNameRoSchema,
  IViewNameRo,
  viewDescriptionRoSchema,
  IViewDescriptionRo,
  viewShareMetaRoSchema,
  IViewShareMetaRo,
  viewSortRoSchema,
  IViewSortRo,
  viewOptionsRoSchema,
  IViewOptionsRo,
  updateOrderRoSchema,
  IUpdateOrderRo,
} from '@teable/openapi';
import type { EnableShareViewVo } from '@teable/openapi';
import { ZodValidationPipe } from '../../..//zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ViewService } from '../view.service';
import { ViewOpenApiService } from './view-open-api.service';

@Controller('api/table/:tableId/view')
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
  @Put('/:viewId/name')
  async updateName(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewNameRoSchema))
    viewNameRo: IViewNameRo
  ): Promise<void> {
    return await this.viewOpenApiService.setViewProperty(tableId, viewId, 'name', viewNameRo.name);
  }

  @Permissions('view|update')
  @Put('/:viewId/description')
  async updateDescription(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewDescriptionRoSchema))
    viewDescriptionRo: IViewDescriptionRo
  ): Promise<void> {
    return await this.viewOpenApiService.setViewProperty(
      tableId,
      viewId,
      'description',
      viewDescriptionRo.description
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/share-meta')
  async updateShareMeta(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewShareMetaRoSchema))
    viewShareMetaRo: IViewShareMetaRo
  ): Promise<void> {
    return await this.viewOpenApiService.setViewProperty(
      tableId,
      viewId,
      'shareMeta',
      viewShareMetaRo
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/manual-sort')
  async manualSort(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(manualSortRoSchema))
    updateViewOrderRo: IManualSortRo
  ): Promise<void> {
    return await this.viewOpenApiService.manualSort(tableId, viewId, updateViewOrderRo);
  }

  @Permissions('view|update')
  @Put('/:viewId/column-meta')
  async updateFieldsVisible(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(columnMetaRoSchema))
    updateViewColumnMetaRo: IColumnMetaRo
  ): Promise<void> {
    return await this.viewOpenApiService.updateViewColumnMeta(
      tableId,
      viewId,
      updateViewColumnMetaRo
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/filter')
  async updateViewFilter(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(filterRoSchema))
    updateViewFilterRo: IFilterRo
  ): Promise<void> {
    return await this.viewOpenApiService.setViewProperty(
      tableId,
      viewId,
      'filter',
      updateViewFilterRo.filter
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/sort')
  async updateViewSort(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewSortRoSchema))
    updateViewSortRo: IViewSortRo
  ): Promise<void> {
    return await this.viewOpenApiService.setViewProperty(
      tableId,
      viewId,
      'sort',
      updateViewSortRo.sort
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/group')
  async updateViewGroup(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewGroupRoSchema))
    updateViewGroupRo: IViewGroupRo
  ): Promise<void> {
    return await this.viewOpenApiService.setViewProperty(
      tableId,
      viewId,
      'group',
      updateViewGroupRo.group
    );
  }

  @Permissions('view|update')
  @Patch('/:viewId/options')
  async updateViewOptions(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewOptionsRoSchema))
    updateViewOptionRo: IViewOptionsRo
  ): Promise<void> {
    return await this.viewOpenApiService.patchViewOptions(
      tableId,
      viewId,
      updateViewOptionRo.options
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/order')
  async updateViewOrder(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(updateOrderRoSchema))
    updateOrderRo: IUpdateOrderRo
  ): Promise<void> {
    return await this.viewOpenApiService.updateViewOrder(tableId, viewId, updateOrderRo);
  }

  @Permissions('view|update')
  @Post('/:viewId/refresh-share-id')
  async refreshShareId(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<EnableShareViewVo> {
    return await this.viewOpenApiService.refreshShareId(tableId, viewId);
  }

  @Permissions('view|update')
  @Post('/:viewId/enable-share')
  async enableShare(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<EnableShareViewVo> {
    return await this.viewOpenApiService.enableShare(tableId, viewId);
  }

  @Permissions('view|update')
  @Post('/:viewId/disable-share')
  async disableShare(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<void> {
    return await this.viewOpenApiService.disableShare(tableId, viewId);
  }
}
