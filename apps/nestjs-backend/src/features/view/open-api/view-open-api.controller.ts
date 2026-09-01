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
import type {
  IViewVo,
  IManualSortRo,
  IViewRo,
  IColumnMetaRo,
  IFilterRo,
  IViewGroupRo,
} from '@teable/core';
import {
  viewRoSchema,
  manualSortRoSchema,
  columnMetaRoSchema,
  filterRoSchema,
  viewGroupRoSchema,
} from '@teable/core';
import type {
  IViewNameRo,
  IViewDescriptionRo,
  IViewShareMetaRo,
  IViewSortRo,
  IViewOptionsRo,
  IUpdateOrderRo,
  IUpdateRecordOrdersRo,
  IViewInstallPluginRo,
  IViewPluginUpdateStorageRo,
  IViewLockedRo,
} from '@teable/openapi';
import {
  viewNameRoSchema,
  viewDescriptionRoSchema,
  viewShareMetaRoSchema,
  viewSortRoSchema,
  viewOptionsRoSchema,
  updateOrderRoSchema,
  updateRecordOrdersRoSchema,
  viewInstallPluginRoSchema,
  viewPluginUpdateStorageRoSchema,
  viewLockedRoSchema,
} from '@teable/openapi';
import type {
  IEnableShareViewVo,
  IRefreshShareViewVo,
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
  @UseV2Feature('getView')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async getView(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<IViewVo> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.getView(tableId, viewId);
    }
    return await this.viewService.getViewById(tableId, viewId);
  }

  @Permissions('view|read')
  @Get()
  @UseV2Feature('getViews')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async getViews(@Param('tableId') tableId: string): Promise<IViewVo[]> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.getViews(tableId);
    }
    return await this.viewService.getViews(tableId);
  }

  @Permissions('view|create')
  @Post()
  @UseV2Feature('createView')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @EmitControllerEvent(Events.OPERATION_VIEW_CREATE, { skipWhenV2: true })
  async createView(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(viewRoSchema)) viewRo: IViewRo
  ): Promise<IViewVo> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.createView(tableId, viewRo);
    }
    return await this.viewOpenApiService.createView(tableId, viewRo);
  }

  @Permissions('view|delete')
  @Delete('/:viewId')
  @UseV2Feature('deleteView')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async deleteView(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Headers('x-window-id') windowId?: string
  ) {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.deleteView(tableId, viewId, windowId);
    }
    return await this.viewOpenApiService.deleteView(tableId, viewId, windowId);
  }

  @Permissions('view|update')
  @Put('/:viewId/name')
  @UseV2Feature('updateViewName')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async updateName(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewNameRoSchema)) viewNameRo: IViewNameRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.updateName(tableId, viewId, viewNameRo.name, windowId);
    }
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
  @UseV2Feature('updateViewDescription')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async updateDescription(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewDescriptionRoSchema)) viewDescriptionRo: IViewDescriptionRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.updateDescription(
        tableId,
        viewId,
        viewDescriptionRo.description,
        windowId
      );
    }
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
  @UseV2Feature('updateViewLocked')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async updateLocked(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewLockedRoSchema)) viewLockedRo: IViewLockedRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.updateLocked(
        tableId,
        viewId,
        viewLockedRo.isLocked,
        windowId
      );
    }
    return await this.viewOpenApiService.setViewProperty(
      tableId,
      viewId,
      'isLocked',
      viewLockedRo.isLocked,
      windowId
    );
  }

  @Permissions('view|share')
  @Put('/:viewId/share-meta')
  @UseV2Feature('updateViewShareMeta')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async updateShareMeta(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewShareMetaRoSchema)) viewShareMetaRo: IViewShareMetaRo
  ): Promise<void> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.updateShareMeta(tableId, viewId, viewShareMetaRo);
    }
    return await this.viewOpenApiService.updateShareMeta(tableId, viewId, viewShareMetaRo);
  }

  @Permissions('view|update')
  @Put('/:viewId/manual-sort')
  @UseV2Feature('manualSortView')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async manualSort(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(manualSortRoSchema)) updateViewOrderRo: IManualSortRo
  ): Promise<void> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.manualSort(tableId, viewId, updateViewOrderRo);
    }
    return await this.viewOpenApiService.manualSort(tableId, viewId, updateViewOrderRo);
  }

  @Permissions('view|update')
  @Put('/:viewId/column-meta')
  @UseV2Feature('updateViewColumnMeta')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async updateColumnMeta(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(columnMetaRoSchema)) updateViewColumnMetaRo: IColumnMetaRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.updateColumnMeta(
        tableId,
        viewId,
        updateViewColumnMetaRo,
        windowId
      );
    }
    return await this.viewOpenApiService.updateViewColumnMeta(
      tableId,
      viewId,
      updateViewColumnMetaRo,
      windowId
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/filter')
  @UseV2Feature('updateViewFilter')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async updateViewFilter(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(filterRoSchema)) updateViewFilterRo: IFilterRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.updateFilter(
        tableId,
        viewId,
        updateViewFilterRo,
        windowId
      );
    }
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
  @UseV2Feature('updateViewSort')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async updateViewSort(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewSortRoSchema)) updateViewSortRo: IViewSortRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.updateSort(
        tableId,
        viewId,
        updateViewSortRo,
        windowId
      );
    }
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
  @UseV2Feature('updateViewGroup')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async updateViewGroup(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewGroupRoSchema)) updateViewGroupRo: IViewGroupRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.updateGroup(
        tableId,
        viewId,
        updateViewGroupRo,
        windowId
      );
    }
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
  @UseV2Feature('updateViewOptions')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async updateViewOptions(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(viewOptionsRoSchema)) updateViewOptionRo: IViewOptionsRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.updateOptions(
        tableId,
        viewId,
        updateViewOptionRo.options,
        windowId
      );
    }
    return await this.viewOpenApiService.patchViewOptions(
      tableId,
      viewId,
      updateViewOptionRo.options,
      windowId
    );
  }

  @Permissions('view|update')
  @Put('/:viewId/order')
  @UseV2Feature('updateViewOrder')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async updateViewOrder(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(updateOrderRoSchema)) updateOrderRo: IUpdateOrderRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<void> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.updateOrder(tableId, viewId, updateOrderRo, windowId);
    }
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

  @Permissions('view|share')
  @Post('/:viewId/refresh-share-id')
  @UseV2Feature('refreshViewShareId')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async refreshShareId(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<IRefreshShareViewVo> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.refreshShareId(tableId, viewId);
    }
    return await this.viewOpenApiService.refreshShareId(tableId, viewId);
  }

  @Permissions('view|share')
  @Post('/:viewId/enable-share')
  @UseV2Feature('enableViewShare')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async enableShare(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<IEnableShareViewVo> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.enableShare(tableId, viewId);
    }
    return await this.viewOpenApiService.enableShare(tableId, viewId);
  }

  @Permissions('view|update')
  @Post('/:viewId/disable-share')
  @UseV2Feature('disableViewShare')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async disableShare(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<void> {
    if (this.cls.get('useV2')) {
      return await this.viewOpenApiV2Service.disableShare(tableId, viewId);
    }
    return await this.viewOpenApiService.disableShare(tableId, viewId);
  }

  @Permissions('view|read')
  @Get('/:viewId/filter-link-records')
  @UseV2Feature('getViewFilterLinkRecords')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async getFilterLinkRecords(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<IGetViewFilterLinkRecordsVo> {
    if (this.cls.get('useV2')) {
      return this.viewOpenApiV2Service.getViewFilterLinkRecords(tableId, viewId);
    }
    return this.viewOpenApiService.getFilterLinkRecords(tableId, viewId);
  }

  @Permissions('view|read')
  @Get('/socket/snapshot-bulk')
  @UseV2Feature('getViewSocketSnapshotBulk')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async getSnapshotBulk(@Param('tableId') tableId: string, @Query('ids') ids: string[]) {
    if (this.cls.get('useV2')) {
      return this.viewOpenApiV2Service.getSnapshotBulk(tableId, ids);
    }
    return this.viewService.getSnapshotBulk(tableId, ids);
  }

  @Permissions('view|read')
  @Get('/socket/doc-ids')
  @UseV2Feature('getViewSocketDocIds')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async getDocIds(@Param('tableId') tableId: string) {
    if (this.cls.get('useV2')) {
      return this.viewOpenApiV2Service.getDocIds(tableId);
    }
    return this.viewService.getDocIdsByQuery(tableId, undefined);
  }

  @Permissions('view|create')
  @Post('/plugin')
  @UseV2Feature('installViewPlugin')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async pluginInstall(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(viewInstallPluginRoSchema)) ro: IViewInstallPluginRo
  ): Promise<IViewInstallPluginVo> {
    if (this.cls.get('useV2')) {
      return this.viewOpenApiV2Service.installPlugin(tableId, ro);
    }
    return this.viewOpenApiService.pluginInstall(tableId, ro);
  }

  @Get(':viewId/plugin')
  @Permissions('view|read')
  @UseV2Feature('getViewPluginInstall')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async getPluginInstall(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string
  ): Promise<IGetViewInstallPluginVo> {
    if (this.cls.get('useV2')) {
      return this.viewOpenApiV2Service.getPluginInstall(tableId, viewId);
    }
    return this.viewOpenApiService.getPluginInstall(tableId, viewId);
  }

  @Permissions('view|update')
  @Patch(':viewId/plugin/:pluginInstallId')
  @UseV2Feature('updateViewPluginStorage')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async pluginUpdateStorage(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Param('pluginInstallId') pluginInstallId: string,
    @Body(new ZodValidationPipe(viewPluginUpdateStorageRoSchema))
    ro: IViewPluginUpdateStorageRo
  ) {
    if (this.cls.get('useV2')) {
      return this.viewOpenApiV2Service.updatePluginStorage(
        tableId,
        viewId,
        pluginInstallId,
        ro.storage
      );
    }
    return this.viewOpenApiService.updatePluginStorage(
      tableId,
      viewId,
      pluginInstallId,
      ro.storage
    );
  }

  @Permissions('view|create')
  @Post('/:viewId/duplicate')
  @UseV2Feature('duplicateView')
  @UseGuards(V2FeatureGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  async duplicateView(@Param('tableId') tableId: string, @Param('viewId') viewId: string) {
    if (this.cls.get('useV2')) {
      return this.viewOpenApiV2Service.duplicateView(tableId, viewId);
    }

    return this.viewOpenApiService.duplicateView(tableId, viewId);
  }
}
