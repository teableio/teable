import { HttpException, HttpStatus, Injectable, Optional } from '@nestjs/common';
import type {
  IColumnMetaRo,
  IFilterRo,
  IManualSortRo,
  IPluginViewOptions,
  ISnapshotBase,
  IViewGroupRo,
  IViewOptions,
  IViewRo,
  IViewVo,
} from '@teable/core';
import { viewVoSchema } from '@teable/core';
import {
  getViewFilterLinkRecordsVoSchema,
  type IGetViewFilterLinkRecordsVo,
  type IRefreshShareViewVo,
  type IEnableShareViewVo,
  type IGetViewInstallPluginVo,
  type IUpdateRecordOrdersRo,
  type IUpdateOrderRo,
  type IViewInstallPluginRo,
  type IViewInstallPluginVo,
  type IViewPluginUpdateStorageRo,
  type IViewPluginUpdateStorageVo,
  type IViewShareMetaRo,
  type IViewSortRo,
} from '@teable/openapi';
import { mapDomainErrorToHttpError, mapDomainErrorToHttpStatus } from '@teable/v2-contract-http';
import { executeReorderRecordsEndpoint } from '@teable/v2-contract-http-implementation/handlers';
import type {
  CreateViewResult,
  DisableViewShareResult,
  EnableViewShareResult,
  ApplyViewManualSortResult,
  DeleteViewResult,
  DuplicateViewResult,
  GetViewFilterLinkRecordsResult,
  GetViewPluginInstallResult,
  GetViewResult,
  GetViewSnapshotsResult,
  ICommandBus,
  IExecutionContext,
  IQueryBus,
  ListViewsResult,
  RefreshViewShareIdResult,
  RenameViewResult,
  UpdateViewDescriptionResult,
  UpdateViewFilterResult,
  UpdateViewGroupResult,
  UpdateViewOptionsResult,
  UpdateViewPluginStorageResult,
  UpdateViewShareMetaResult,
  UpdateViewLockedResult,
  UpdateViewColumnMetaResult,
  UpdateViewOrderResult,
  UpdateViewSortResult,
  ViewQueryResultView,
} from '@teable/v2-core';
import {
  CreateViewCommand,
  DisableViewShareCommand,
  EnableViewShareCommand,
  ApplyViewManualSortCommand,
  DeleteViewCommand,
  DuplicateViewCommand,
  GetViewFilterLinkRecordsQuery,
  GetViewPluginInstallQuery,
  GetViewQuery,
  GetViewSnapshotsQuery,
  ListViewsQuery,
  projectViewForQuery,
  RefreshViewShareIdCommand,
  RenameViewCommand,
  UpdateViewDescriptionCommand,
  UpdateViewFilterCommand,
  UpdateViewGroupCommand,
  UpdateViewOptionsCommand,
  UpdateViewPluginStorageCommand,
  UpdateViewShareMetaCommand,
  UpdateViewLockedCommand,
  UpdateViewColumnMetaCommand,
  UpdateViewOrderCommand,
  UpdateViewSortCommand,
  v2CoreTokens,
} from '@teable/v2-core';

import { convertViewVoAttachmentUrl } from '../../../utils/convert-view-vo-attachment-url';
import { SpaceDataDbMigrationGuardService } from '../../space/space-data-db-migration-guard.service';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { throwV2Error } from '../../v2/v2-http-error';

const internalServerError = 'Internal server error';

@Injectable()
export class ViewOpenApiV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    @Optional()
    private readonly spaceDataDbMigrationGuard?: SpaceDataDbMigrationGuardService
  ) {}

  async createView(tableId: string, viewRo: IViewRo): Promise<IViewVo> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

    const commandResult = CreateViewCommand.create({
      tableId,
      view: {
        name: viewRo.name,
        type: viewRo.type,
        description: viewRo.description,
        columnMeta: viewRo.columnMeta,
        options: viewRo.options,
        sourceFilter: viewRo.filter,
        sort: viewRo.sort?.sortObjs,
        manualSort: viewRo.sort?.manualSort,
        group: viewRo.group ?? undefined,
        isLocked: viewRo.isLocked,
        order: viewRo.order,
        enableShare: viewRo.enableShare,
        shareId: viewRo.shareId,
        shareMeta: viewRo.shareMeta,
      },
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<CreateViewCommand, CreateViewResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    return this.getView(tableId, result.value.viewId.toString());
  }

  async installPlugin(tableId: string, ro: IViewInstallPluginRo): Promise<IViewInstallPluginVo> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = CreateViewCommand.create({
      tableId,
      view: {
        name: ro.name,
        type: 'plugin',
        options: { pluginId: ro.pluginId },
      },
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<CreateViewCommand, CreateViewResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    const viewResult = result.value.table.getView(result.value.viewId);
    if (viewResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(viewResult.error),
        mapDomainErrorToHttpStatus(viewResult.error)
      );
    }
    const view = viewResult.value;
    const options = view.options() as IPluginViewOptions;
    return {
      pluginId: options.pluginId,
      pluginInstallId: options.pluginInstallId,
      name: view.name().toString(),
      viewId: view.id().toString(),
    };
  }

  async getPluginInstall(tableId: string, viewId: string): Promise<IGetViewInstallPluginVo> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const context = await this.v2ContextFactory.createContext(container);
    const queryResult = GetViewPluginInstallQuery.create({ tableId, viewId });
    if (queryResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(queryResult.error),
        mapDomainErrorToHttpStatus(queryResult.error)
      );
    }

    const result = await queryBus.execute<GetViewPluginInstallQuery, GetViewPluginInstallResult>(
      context,
      queryResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
    const installation = result.value.installation;
    return {
      pluginId: installation.pluginId,
      pluginInstallId: installation.id,
      baseId: installation.baseId,
      name: installation.name,
      ...(installation.url !== undefined ? { url: installation.url } : {}),
      ...(installation.storage !== undefined ? { storage: { ...installation.storage } } : {}),
    };
  }

  async updatePluginStorage(
    tableId: string,
    viewId: string,
    pluginInstallId: string,
    storage: IViewPluginUpdateStorageRo['storage']
  ): Promise<IViewPluginUpdateStorageVo> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = UpdateViewPluginStorageCommand.create({
      tableId,
      viewId,
      pluginInstallId,
      storage,
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<
      UpdateViewPluginStorageCommand,
      UpdateViewPluginStorageResult
    >(context, commandResult.value);
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
    return {
      tableId: result.value.tableId,
      viewId: result.value.viewId,
      pluginInstallId: result.value.pluginInstallId,
      ...(result.value.storage !== undefined ? { storage: { ...result.value.storage } } : {}),
    };
  }

  async manualSort(tableId: string, viewId: string, sortRo: IManualSortRo): Promise<void> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = ApplyViewManualSortCommand.create({
      tableId,
      viewId,
      sort: sortRo.sortObjs,
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<ApplyViewManualSortCommand, ApplyViewManualSortResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
  }

  async getView(
    tableId: string,
    viewId: string,
    contextOverride?: IExecutionContext
  ): Promise<IViewVo> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const context = contextOverride ?? (await this.v2ContextFactory.createContext(container));
    const queryResult = GetViewQuery.create({ tableId, viewId });
    if (queryResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(queryResult.error),
        mapDomainErrorToHttpStatus(queryResult.error)
      );
    }

    const result = await queryBus.execute<GetViewQuery, GetViewResult>(context, queryResult.value);
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    return this.toViewVo(result.value.view);
  }

  async deleteView(tableId: string, viewId: string, _windowId?: string): Promise<void> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = DeleteViewCommand.create({ tableId, viewId });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<DeleteViewCommand, DeleteViewResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
  }

  async updateName(
    tableId: string,
    viewId: string,
    name: string,
    _windowId?: string
  ): Promise<void> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = RenameViewCommand.create({ tableId, viewId, name });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<RenameViewCommand, RenameViewResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
  }

  async updateDescription(
    tableId: string,
    viewId: string,
    description: string,
    _windowId?: string
  ): Promise<void> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = UpdateViewDescriptionCommand.create({
      tableId,
      viewId,
      description,
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<
      UpdateViewDescriptionCommand,
      UpdateViewDescriptionResult
    >(context, commandResult.value);
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
  }

  async updateLocked(
    tableId: string,
    viewId: string,
    isLocked: boolean | undefined,
    _windowId?: string
  ): Promise<void> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = UpdateViewLockedCommand.create({
      tableId,
      viewId,
      isLocked,
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<UpdateViewLockedCommand, UpdateViewLockedResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
  }

  async updateOrder(
    tableId: string,
    viewId: string,
    orderRo: IUpdateOrderRo,
    _windowId?: string
  ): Promise<void> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = UpdateViewOrderCommand.create({
      tableId,
      viewId,
      anchorId: orderRo.anchorId,
      position: orderRo.position,
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<UpdateViewOrderCommand, UpdateViewOrderResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
  }

  async updateColumnMeta(
    tableId: string,
    viewId: string,
    columnMetaRo: IColumnMetaRo,
    _windowId?: string
  ): Promise<void> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = UpdateViewColumnMetaCommand.create({
      tableId,
      viewId,
      columnMeta: columnMetaRo,
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<
      UpdateViewColumnMetaCommand,
      UpdateViewColumnMetaResult
    >(context, commandResult.value);
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
  }

  async updateFilter(
    tableId: string,
    viewId: string,
    filterRo: IFilterRo,
    _windowId?: string
  ): Promise<void> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = UpdateViewFilterCommand.create({
      tableId,
      viewId,
      filter: filterRo.filter,
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }
    const result = await commandBus.execute<UpdateViewFilterCommand, UpdateViewFilterResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
  }

  async updateSort(
    tableId: string,
    viewId: string,
    sortRo: IViewSortRo,
    _windowId?: string
  ): Promise<void> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = UpdateViewSortCommand.create({
      tableId,
      viewId,
      sort: sortRo.sort,
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }
    const result = await commandBus.execute<UpdateViewSortCommand, UpdateViewSortResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
  }

  async updateGroup(
    tableId: string,
    viewId: string,
    groupRo: IViewGroupRo,
    _windowId?: string
  ): Promise<void> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = UpdateViewGroupCommand.create({
      tableId,
      viewId,
      group: groupRo.group,
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }
    const result = await commandBus.execute<UpdateViewGroupCommand, UpdateViewGroupResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
  }

  async updateOptions(
    tableId: string,
    viewId: string,
    options: IViewOptions,
    _windowId?: string
  ): Promise<void> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = UpdateViewOptionsCommand.create({
      tableId,
      viewId,
      options,
    });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }
    const result = await commandBus.execute<UpdateViewOptionsCommand, UpdateViewOptionsResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
  }

  async updateShareMeta(
    tableId: string,
    viewId: string,
    shareMeta: IViewShareMetaRo
  ): Promise<void> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = UpdateViewShareMetaCommand.create({ tableId, viewId, shareMeta });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }
    const result = await commandBus.execute<UpdateViewShareMetaCommand, UpdateViewShareMetaResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
  }

  async refreshShareId(tableId: string, viewId: string): Promise<IRefreshShareViewVo> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = RefreshViewShareIdCommand.create({ tableId, viewId });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }
    const result = await commandBus.execute<RefreshViewShareIdCommand, RefreshViewShareIdResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
    return { shareId: result.value.shareId };
  }

  async enableShare(tableId: string, viewId: string): Promise<IEnableShareViewVo> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = EnableViewShareCommand.create({ tableId, viewId });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }
    const result = await commandBus.execute<EnableViewShareCommand, EnableViewShareResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
    return { shareId: result.value.shareId };
  }

  async disableShare(tableId: string, viewId: string): Promise<void> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = DisableViewShareCommand.create({ tableId, viewId });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }
    const result = await commandBus.execute<DisableViewShareCommand, DisableViewShareResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
  }

  async getViews(tableId: string, viewIds?: ReadonlyArray<string>): Promise<IViewVo[]> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const context = await this.v2ContextFactory.createContext(container);
    const queryResult = ListViewsQuery.create({ tableId, viewIds });
    if (queryResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(queryResult.error),
        mapDomainErrorToHttpStatus(queryResult.error)
      );
    }

    const result = await queryBus.execute<ListViewsQuery, ListViewsResult>(
      context,
      queryResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    return result.value.views.map((view) => this.toViewVo(view));
  }

  async getSnapshotBulk(
    tableId: string,
    ids: ReadonlyArray<string> | string | undefined
  ): Promise<ISnapshotBase<IViewVo>[]> {
    const viewIds = Array.isArray(ids) ? [...ids] : typeof ids === 'string' ? [ids] : [];
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const context = await this.v2ContextFactory.createContext(container);
    const queryResult = GetViewSnapshotsQuery.create({ tableId, viewIds });
    if (queryResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(queryResult.error),
        mapDomainErrorToHttpStatus(queryResult.error)
      );
    }

    const result = await queryBus.execute<GetViewSnapshotsQuery, GetViewSnapshotsResult>(
      context,
      queryResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    return result.value.snapshots.map((snapshot) => ({
      id: snapshot.id,
      v: snapshot.version,
      type: 'json0',
      data: this.toViewVo(snapshot.view),
    }));
  }

  async getDocIds(tableId: string, viewIds?: ReadonlyArray<string>): Promise<{ ids: string[] }> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const context = await this.v2ContextFactory.createContext(container);
    const queryResult = ListViewsQuery.create({ tableId, viewIds });
    if (queryResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(queryResult.error),
        mapDomainErrorToHttpStatus(queryResult.error)
      );
    }

    const result = await queryBus.execute<ListViewsQuery, ListViewsResult>(
      context,
      queryResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
    return { ids: result.value.views.map((view) => view.id) };
  }

  async getViewFilterLinkRecords(
    tableId: string,
    viewId: string
  ): Promise<IGetViewFilterLinkRecordsVo> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const context = await this.v2ContextFactory.createContext(container);
    const queryResult = GetViewFilterLinkRecordsQuery.create({ tableId, viewId });
    if (queryResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(queryResult.error),
        mapDomainErrorToHttpStatus(queryResult.error)
      );
    }

    const result = await queryBus.execute<
      GetViewFilterLinkRecordsQuery,
      GetViewFilterLinkRecordsResult
    >(context, queryResult.value);
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    const parsed = getViewFilterLinkRecordsVoSchema.safeParse(result.value.groups);
    if (!parsed.success) {
      throwV2Error(
        {
          code: 'view.filter_link_records.invalid_projection',
          message: 'Invalid View filter link records projection',
          details: { issues: parsed.error.issues },
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    return parsed.data;
  }

  async updateRecordOrders(
    tableId: string,
    viewId: string,
    updateRecordOrdersRo: IUpdateRecordOrdersRo
  ): Promise<void> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

    const v2Input = {
      tableId,
      recordIds: updateRecordOrdersRo.recordIds,
      order: {
        viewId,
        anchorId: updateRecordOrdersRo.anchorId,
        position: updateRecordOrdersRo.position,
      },
    };

    const result = await executeReorderRecordsEndpoint(context, v2Input, commandBus);
    if (result.status === 200 && result.body.ok) {
      return;
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async duplicateView(tableId: string, viewId: string): Promise<IViewVo> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const commandResult = DuplicateViewCommand.create({ tableId, viewId });
    if (commandResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<DuplicateViewCommand, DuplicateViewResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    // The command result already carries the updated table aggregate; project
    // the created view from it instead of re-loading the whole aggregate
    // through GetViewQuery (a 500-field table costs ~30ms per load).
    const duplicatedView = result.value.table.getView(result.value.viewId);
    if (duplicatedView.isErr()) {
      // Unexpected (the command just created it) — fall back to the query path.
      return this.getView(tableId, result.value.viewId.toString());
    }
    const projected = projectViewForQuery(result.value.table, duplicatedView.value, {
      fieldSet: 'partial',
    });
    if (projected.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(projected.error),
        mapDomainErrorToHttpStatus(projected.error)
      );
    }
    return this.toViewVo(projected.value);
  }

  private toViewVo(view: ViewQueryResultView): IViewVo {
    const parsed = viewVoSchema.safeParse(view);
    if (!parsed.success) {
      throwV2Error(
        {
          code: 'view.invalid_projection',
          message: 'Invalid View projection',
          details: { issues: parsed.error.issues },
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    return convertViewVoAttachmentUrl(parsed.data);
  }
}
