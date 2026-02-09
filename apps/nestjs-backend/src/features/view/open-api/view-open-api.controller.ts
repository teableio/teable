/* eslint-disable sonarjs/no-duplicate-string */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Headers,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
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
  updateRecordOrdersRoSchema,
  IUpdateRecordOrdersRo,
  viewInstallPluginRoSchema,
  IViewInstallPluginRo,
  viewPluginUpdateStorageRoSchema,
  IViewPluginUpdateStorageRo,
  viewLockedRoSchema,
  IViewLockedRo,
} from '@teable/openapi';
import type {
  IEnableShareViewVo,
  IGetViewFilterLinkRecordsVo,
  IGetViewInstallPluginVo,
  IViewInstallPluginVo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { ZodValidationPipe } from '../../..//zod.validation.pipe';
import { EmitControllerEvent } from '../../../event-emitter/decorators/emit-controller-event.decorator';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { AllowAnonymous } from '../../auth/decorators/allow-anonymous.decorator';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UseV2Feature } from '../../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../../canary/guards/v2-feature.guard';
import { V2IndicatorInterceptor } from '../../canary/interceptors/v2-indicator.interceptor';
import { TableDomainQueryService } from '../../table-domain';
import { ViewService } from '../view.service';
import { ViewOpenApiV2Service } from './view-open-api-v2.service';
import { ViewOpenApiService } from './view-open-api.service';

@Controller('api/table/:tableId/view')
@AllowAnonymous()
export class ViewOpenApiController {
  constructor(
    private readonly viewService: ViewService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly viewOpenApiV2Service: ViewOpenApiV2Service,
    protected readonly tableDomainQueryService: TableDomainQueryService,
    private readonly cls: ClsService<IClsStore>
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
  @EmitControllerEvent(Events.OPERATION_VIEW_CREATE)
  async createView(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(viewRoSchema)) viewRo: IViewRo
  ): Promise<IViewVo> {
    return await this.viewOpenApiService.createView(tableId, viewRo);
  }

  @Permissions('view|delete')
  @Delete('/:viewId')
  async deleteView(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Headers('x-window-id') windowId?: string
  ) {
    return await this.viewOpenApiService.deleteView(tableId, viewId, windowId);
  }

  @Permissions('view|update')
  @Put('/:viewId/name')
  async updateName(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewNameRoSchema)) viewNameRo: IViewNameRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    return await this.viewOpenApiService.setViewProperty(
      tableId,
      viewId,
      'name',
      viewNameRo.name,
      windowId
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/description')
  async updateDescription(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewDescriptionRoSchema)) viewDescriptionRo: IViewDescriptionRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    return await this.viewOpenApiService.setViewProperty(
      tableId,
      viewId,
      'description',
      viewDescriptionRo.description,
      windowId
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/locked')
  async updateLocked(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewLockedRoSchema)) viewLockedRo: IViewLockedRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    return await this.viewOpenApiService.setViewProperty(
      tableId,
      viewId,
      'isLocked',
      viewLockedRo.isLocked,
      windowId
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/share-meta')
  async updateShareMeta(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewShareMetaRoSchema)) viewShareMetaRo: IViewShareMetaRo
  ): Promise<void> {
    return await this.viewOpenApiService.updateShareMeta(tableId, viewId, viewShareMetaRo);
  }

  @Permissions('view|update')
  @Put('/:viewId/manual-sort')
  async manualSort(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(manualSortRoSchema)) updateViewOrderRo: IManualSortRo
  ): Promise<void> {
    return await this.viewOpenApiService.manualSort(tableId, viewId, updateViewOrderRo);
  }

  @Permissions('view|update')
  @Put('/:viewId/column-meta')
  async updateColumnMeta(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(columnMetaRoSchema)) updateViewColumnMetaRo: IColumnMetaRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    return await this.viewOpenApiService.updateViewColumnMeta(
      tableId,
      viewId,
      updateViewColumnMetaRo,
      windowId
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/filter')
  async updateViewFilter(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(filterRoSchema)) updateViewFilterRo: IFilterRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    return await this.viewOpenApiService.setViewProperty(
      tableId,
      viewId,
      'filter',
      updateViewFilterRo.filter,
      windowId
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/sort')
  async updateViewSort(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewSortRoSchema)) updateViewSortRo: IViewSortRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    return await this.viewOpenApiService.setViewProperty(
      tableId,
      viewId,
      'sort',
      updateViewSortRo.sort,
      windowId
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/group')
  async updateViewGroup(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewGroupRoSchema)) updateViewGroupRo: IViewGroupRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    return await this.viewOpenApiService.setViewProperty(
      tableId,
      viewId,
      'group',
      updateViewGroupRo.group,
      windowId
    );
  }

  @Permissions('view|update')
  @Patch('/:viewId/options')
  async updateViewOptions(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewOptionsRoSchema)) updateViewOptionRo: IViewOptionsRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    return await this.viewOpenApiService.patchViewOptions(
      tableId,
      viewId,
      updateViewOptionRo.options,
      windowId
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/order')
  async updateViewOrder(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(updateOrderRoSchema)) updateOrderRo: IUpdateOrderRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    return await this.viewOpenApiService.updateViewOrder(tableId, viewId, updateOrderRo, windowId);
  }

  @Permissions('view|update')
  @Put('/:viewId/record-order')
  @UseV2Feature('reorderRecords')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async updateRecordOrders(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(updateRecordOrdersRoSchema))
    updateRecordOrdersRo: IUpdateRecordOrdersRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    if (this.cls.get('useV2')) {
      await this.viewOpenApiV2Service.updateRecordOrders(tableId, viewId, updateRecordOrdersRo);
      return;
    }

    const table = await this.tableDomainQueryService.getTableDomainById(tableId);
    return await this.viewOpenApiService.updateRecordOrders(
      table,
      viewId,
      updateRecordOrdersRo,
      windowId
    );
  }

  @Permissions('view|update')
  @Post('/:viewId/refresh-share-id')
  async refreshShareId(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<IEnableShareViewVo> {
    return await this.viewOpenApiService.refreshShareId(tableId, viewId);
  }

  @Permissions('view|share')
  @Post('/:viewId/enable-share')
  async enableShare(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<IEnableShareViewVo> {
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

  @Permissions('view|read')
  @Get('/:viewId/filter-link-records')
  async getFilterLinkRecords(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<IGetViewFilterLinkRecordsVo> {
    return this.viewOpenApiService.getFilterLinkRecords(tableId, viewId);
  }

  @Permissions('view|read')
  @Get('/socket/snapshot-bulk')
  async getSnapshotBulk(@Param('tableId') tableId: string, @Query('ids') ids: string[]) {
    return this.viewService.getSnapshotBulk(tableId, ids);
  }

  @Permissions('view|read')
  @Get('/socket/doc-ids')
  async getDocIds(@Param('tableId') tableId: string) {
    return this.viewService.getDocIdsByQuery(tableId, undefined);
  }

  @Permissions('view|create')
  @Post('/plugin')
  async pluginInstall(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(viewInstallPluginRoSchema)) ro: IViewInstallPluginRo
  ): Promise<IViewInstallPluginVo> {
    return this.viewOpenApiService.pluginInstall(tableId, ro);
  }

  @Get(':viewId/plugin')
  @Permissions('view|read')
  getPluginInstall(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<IGetViewInstallPluginVo> {
    return this.viewOpenApiService.getPluginInstall(tableId, viewId);
  }

  @Permissions('view|update')
  @Patch(':viewId/plugin/:pluginInstallId')
  async pluginUpdateStorage(
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewPluginUpdateStorageRoSchema))
    ro: IViewPluginUpdateStorageRo
  ) {
    return this.viewOpenApiService.updatePluginStorage(viewId, ro.storage);
  }

  @Permissions('view|create')
  @Post('/:viewId/duplicate')
  async duplicateView(@Param('tableId') tableId: string, @Param('viewId') viewId: string) {
    return this.viewOpenApiService.duplicateView(tableId, viewId);
  }
}
