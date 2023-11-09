/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import type { IViewVo } from '@teable-group/core';
import { viewRoSchema, manualSortRoSchema, IManualSortRo, IViewRo } from '@teable-group/core';
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
  ) {
    return await this.viewOpenApiService.manualSort(tableId, viewId, updateViewOrderRo);
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
